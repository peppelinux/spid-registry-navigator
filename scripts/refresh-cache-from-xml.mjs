/**
 * Riscarica tutti i metadata XML dal registry e aggiorna i flag in cache
 * (minori, firma, professionale, eIDAS) — fonte autorevole per i filtri.
 *
 * Uso: npm run build:cache:refresh
 *        npm run build:cache:pipeline   (refresh + aggregatori)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { detectXmlPageCount, FETCH_CONCURRENCY, runPool } from './lib/fetch-pool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '../public/data/metadata-cache-default.json');

const API_BASE = 'https://registry.spid.gov.it';
const SPID_NS = 'https://spid.gov.it/saml-extensions';
const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
const PROFESSIONAL_PURPOSES = new Set(['PG', 'PF', 'LP', 'PX']);
const PROFESSIONAL_ATTRS = new Set([
  'companyName',
  'companyFiscalNumber',
  'ivaCode',
  'registeredOffice',
]);

const LAYERS = [
  { scope: 'IDP', entityType: 'IDP', federationType: null, label: 'IdP' },
  { scope: 'SP', entityType: 'SP', federationType: 'SP', label: 'SP non aggregati' },
  { scope: 'AG', entityType: 'SP', federationType: 'AG', label: 'Aggregati' },
];

globalThis.DOMParser = DOMParser;

function localName(el) {
  return el.localName || el.tagName.split(':').pop();
}

function childText(parent, name) {
  for (const el of parent.getElementsByTagNameNS(SPID_NS, name)) {
    return el.textContent?.trim() || null;
  }
  for (const el of parent.getElementsByTagName('*')) {
    if (localName(el) === name) return el.textContent?.trim() || null;
  }
  return null;
}

function parseAgeLimitElement(al) {
  return {
    acsIndex: childText(al, 'AssertionConsumerServiceIndex'),
    minAge: childText(al, 'MinAge'),
    maxAge: childText(al, 'MaxAge'),
    ageParentAuth: childText(al, 'AgeParentAuth'),
  };
}

function acsIsProfessional(acs) {
  for (const attr of acs.getElementsByTagNameNS(MD_NS, 'RequestedAttribute')) {
    const name = attr.getAttribute('Name') || attr.getAttribute('name');
    if (name && PROFESSIONAL_ATTRS.has(name)) return true;
  }
  for (const sn of acs.getElementsByTagNameNS(MD_NS, 'ServiceName')) {
    if (sn.textContent?.trim().toLowerCase() === 'pro') return true;
  }
  return false;
}

function parseEntityDescriptor(ed) {
  const entityId = ed.getAttribute('entityID') || '';
  const ageLimits = [...ed.getElementsByTagNameNS(SPID_NS, 'AgeLimit')].map(parseAgeLimitElement);
  const purposes = [];
  for (const spidEl of ed.getElementsByTagNameNS(SPID_NS, '*')) {
    if (localName(spidEl) === 'Purpose' && spidEl.textContent?.trim()) {
      purposes.push(spidEl.textContent.trim());
    }
  }
  const supportedAgeLimit = ed.getElementsByTagNameNS(SPID_NS, 'SupportedAgeLimit').length > 0;
  let hasAcs77 = false;
  let hasEidasAcs = false;
  let hasProfessionalAcs = false;
  for (const acs of ed.getElementsByTagNameNS(MD_NS, 'AttributeConsumingService')) {
    const idx = acs.getAttribute('index');
    if (idx === '77') hasAcs77 = true;
    if (idx === '99' || idx === '100') hasEidasAcs = true;
    if (!hasProfessionalAcs && acsIsProfessional(acs)) hasProfessionalAcs = true;
  }
  return {
    entityId,
    ageLimits,
    hasAgeLimit: ageLimits.length > 0,
    supportedAgeLimit,
    hasAcs77,
    hasEidasAcs,
    hasProfessionalAcs,
    purposes,
    scannedAt: new Date().toISOString(),
  };
}

function entityDescriptorsInBundle(doc) {
  const containers = [...doc.getElementsByTagNameNS(MD_NS, 'EntitiesDescriptor')];
  const container = containers[0] || doc.documentElement;
  const direct = [...container.children].filter(
    (el) => el.namespaceURI === MD_NS && localName(el) === 'EntityDescriptor',
  );
  if (direct.length) return direct;
  let descriptors = [...doc.getElementsByTagNameNS(MD_NS, 'EntityDescriptor')];
  if (!descriptors.length) {
    descriptors = [...doc.getElementsByTagName('*')].filter(
      (el) => localName(el) === 'EntityDescriptor',
    );
  }
  return descriptors;
}

function parseAllFromBundle(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  return entityDescriptorsInBundle(doc)
    .map((ed) => parseEntityDescriptor(ed))
    .filter((p) => p.entityId);
}

function flagsFromParsed(parsed, entityType) {
  const professionaleXml =
    entityType === 'IDP'
      ? (parsed.purposes || []).some((p) => PROFESSIONAL_PURPOSES.has(p))
      : Boolean(parsed.hasProfessionalAcs);
  return {
    minoriXml: entityType === 'IDP' ? parsed.supportedAgeLimit : parsed.hasAgeLimit,
    supportedAgeLimit: parsed.supportedAgeLimit,
    hasAgeLimit: parsed.hasAgeLimit,
    ageLimits: parsed.ageLimits,
    firmaXml: parsed.hasAcs77,
    eidasXml: Boolean(parsed.hasEidasAcs),
    professionaleXml,
    purposes: parsed.purposes,
  };
}

function countFilterFlags(entries) {
  const exts = ['minori', 'firma', 'professionale', 'eidas'];
  const types = ['IDP', 'SP', 'AG'];
  const out = {};
  for (const t of types) {
    out[t] = {};
    for (const ext of exts) {
      out[t][ext] = Object.values(entries).filter((e) => {
        if (e.entityType !== t) return false;
        const f = e.flags || {};
        if (ext === 'minori') return t === 'IDP' ? f.supportedAgeLimit : f.minoriXml;
        if (ext === 'firma') return Boolean(f.firmaXml);
        if (ext === 'professionale') {
          return t === 'IDP'
            ? (e.purposes || []).some((p) => PROFESSIONAL_PURPOSES.has(p))
            : f.professionaleXml;
        }
        if (ext === 'eidas') return Boolean(f.eidasXml);
        return false;
      }).length;
    }
  }
  return out;
}

async function fetchPageXml({ entityType, federationType, page, pageSize = 50 }) {
  const url = new URL(`${API_BASE}/entities`);
  url.searchParams.set('entity_type', entityType);
  url.searchParams.set('page', String(page));
  url.searchParams.set('numMetadata', String(pageSize));
  if (federationType) url.searchParams.set('federation_type', federationType);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/samlmetadata+xml' },
  });
  if (response.status === 404) return { xml: '', pages: 0, page };
  if (!response.ok) throw new Error(`HTTP ${response.status} pagina ${page}`);
  return {
    xml: await response.text(),
    pages: Number(response.headers.get('tot-pages') || 0),
    page: Number(response.headers.get('current-page') || page),
  };
}

async function fetchJsonPage({ entityType, federationType, page, pageSize = 50 }) {
  const url = new URL(`${API_BASE}/entities`);
  url.searchParams.set('entity_type', entityType);
  url.searchParams.set('output', 'json');
  url.searchParams.set('page', String(page));
  url.searchParams.set('numMetadata', String(pageSize));
  if (federationType) url.searchParams.set('federation_type', federationType);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return { items: [] };
  if (!response.ok) throw new Error(`JSON HTTP ${response.status} pagina ${page}`);
  const body = await response.json();
  const items = Array.isArray(body) ? body : body?.items ?? [];
  return { items };
}

async function findLastJsonPage(params, pageSize = 50) {
  const first = await fetchJsonPage({ ...params, page: 1, pageSize });
  if (first.items.length === 0) return 1;
  if (first.items.length < pageSize) return 1;

  let lastFull = 1;
  let probePage = 2;
  while (true) {
    const batch = await fetchJsonPage({ ...params, page: probePage, pageSize });
    if (batch.items.length === 0) break;
    if (batch.items.length < pageSize) return probePage;
    lastFull = probePage;
    probePage *= 2;
    if (probePage > 50_000) throw new Error('Limite pagine superato');
  }

  let lo = lastFull + 1;
  let hi = probePage - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const batch = await fetchJsonPage({ ...params, page: mid, pageSize });
    if (batch.items.length > 0) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function refreshAggregatorJsonSnapshot(entries) {
  console.log(`\n=== Aggregati (JSON snapshot) · ${FETCH_CONCURRENCY} workers ===`);
  const params = { entityType: 'SP', federationType: 'AG' };
  const lastPage = await findLastJsonPage(params);
  console.log(`Pagine AG JSON: ${lastPage}`);

  const pages = Array.from({ length: lastPage }, (_, i) => i + 1);
  let done = 0;
  let merged = 0;

  await runPool(pages, FETCH_CONCURRENCY, async (page) => {
    const batch = await fetchJsonPage({ ...params, page });
    for (const item of batch.items) {
      if (!item?.entity_id) continue;
      const entry = entries[item.entity_id];
      if (!entry || entry.entityType !== 'AG') continue;
      entry.registryJson = {
        ...(entry.registryJson || {}),
        eidas_ready: item.eidas_ready ?? null,
        organization_name: item.organization_name ?? null,
        organization_display_name: item.organization_display_name ?? null,
        code: item.code ?? null,
        aggregator_code: item.aggregator_code ?? null,
        aggregator_name: item.aggregator_name ?? null,
      };
      merged += 1;
    }
    done += 1;
    if (done % 50 === 0 || done === lastPage) {
      console.log(`  ${done}/${lastPage} pagine · snapshot AG JSON: ${merged}`);
    }
  });
}

function ingestXmlPage(entries, scope, xml) {
  const parsed = parseAllFromBundle(xml);
  let count = 0;
  for (const item of parsed) {
    if (!item?.entityId) continue;
    count += 1;
    const prev = entries[item.entityId]?.registryJson;
    entries[item.entityId] = {
      entityId: item.entityId,
      entityType: scope,
      scannedAt: item.scannedAt,
      flags: flagsFromParsed(item, scope),
      ageLimits: item.ageLimits,
      purposes: item.purposes,
      ...(prev ? { registryJson: prev } : {}),
    };
  }
  return count;
}

async function scanLayer(layer, entries) {
  const { entityType, federationType, scope, label } = layer;
  console.log(`\n=== ${label} (XML) · ${FETCH_CONCURRENCY} workers ===`);

  const fetchParams = { entityType, federationType };
  const totalPages = await detectXmlPageCount(
    (p) => fetchPageXml(p),
    fetchParams,
  );

  console.log(`Pagine API: ${totalPages}`);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  let processed = 0;
  let done = 0;
  let errors = 0;

  await runPool(pages, FETCH_CONCURRENCY, async (page) => {
    try {
      const { xml } = await fetchPageXml({ entityType, federationType, page });
      const added = ingestXmlPage(entries, scope, xml);
      processed += added;
      done += 1;
      if (done % 20 === 0 || done === totalPages) {
        console.log(
          `  ${done}/${totalPages} pagine · +${added} entity ID (pag. ${page}) · totale ${processed} · cache ${Object.keys(entries).length}`,
        );
      }
    } catch (err) {
      errors += 1;
      console.warn(`  errore pagina ${page}: ${err.message}`);
    }
  });

  if (errors) console.warn(`  ${errors} pagine in errore`);
  return { entityCount: processed, pages: totalPages };
}

async function main() {
  console.log(`Refresh cache da metadata XML (tutti i filtri) · pool=${FETCH_CONCURRENCY}\n`);

  let bundle;
  try {
    bundle = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    bundle = { version: 1, entries: {}, idpSupportedAgeLimit: { entityIds: [] }, scans: {} };
  }

  const entries = bundle.entries || {};

  for (const layer of LAYERS) {
    await scanLayer(layer, entries);
  }
  await refreshAggregatorJsonSnapshot(entries);

  const idpIds = Object.values(entries)
    .filter((e) => e.entityType === 'IDP' && e.flags?.supportedAgeLimit)
    .map((e) => e.entityId);
  bundle.idpSupportedAgeLimit = { entityIds: idpIds, scannedAt: new Date().toISOString() };
  bundle.entries = entries;
  bundle.filterCounts = countFilterFlags(entries);
  bundle.exportedAt = new Date().toISOString();
  bundle.generatedAt = bundle.exportedAt;
  bundle.description =
    'Cache con flag filtri derivati da metadata XML completo (minori, firma, professionale, eIDAS)';

  writeFileSync(CACHE_PATH, JSON.stringify(bundle));
  console.log('\nFilter counts (XML):', JSON.stringify(bundle.filterCounts, null, 2));
  console.log(`\nScritto ${CACHE_PATH} (${Object.keys(entries).length} entity ID)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
