/**
 * Scarica tutti i metadata XML dal registry SPID, costruisce la cache
 * e la scrive in public/data/ (cache + totali registry).
 *
 * Uso: npm run build:cache
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { detectXmlPageCount, FETCH_CONCURRENCY, runPool } from './lib/fetch-pool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_CACHE = join(ROOT, 'public/data/metadata-cache-default.json');
const OUT_TOTALS = join(ROOT, 'public/data/registry-totals-default.json');

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

const PROBE_QUERIES = [
  { key: 'IDP|', params: { entityType: 'IDP', federationType: null } },
  { key: 'SP|SP|', params: { entityType: 'SP', federationType: 'SP' } },
  { key: 'SP|AG|', params: { entityType: 'SP', federationType: 'AG' } },
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

/** Snapshot JSON API per confronto asimmetrie (non usato dai filtri). */
async function mergeRegistryJsonSnapshot(entries) {
  const layers = [
    { entityType: 'SP', federationType: 'SP', label: 'SP' },
    { entityType: 'SP', federationType: 'AG', label: 'AG' },
    { entityType: 'IDP', federationType: null, label: 'IdP' },
  ];
  let merged = 0;
  for (const layer of layers) {
    console.log(`\nSnapshot JSON (${layer.label}) · ${FETCH_CONCURRENCY} workers…`);
    const lastPage = await findLastJsonPage({
      entityType: layer.entityType,
      federationType: layer.federationType,
    });
    const pageNums = Array.from({ length: lastPage }, (_, i) => i + 1);
    let done = 0;
    await runPool(pageNums, FETCH_CONCURRENCY, async (page) => {
      const batch = await fetchJsonPage({
        entityType: layer.entityType,
        federationType: layer.federationType,
        page,
      });
      let pageMerged = 0;
      for (const item of batch.items) {
        if (!item?.entity_id) continue;
        const entry = entries[item.entity_id];
        if (!entry) continue;
        entry.registryJson = {
          eidas_ready: item.eidas_ready ?? null,
          organization_name: item.organization_name ?? null,
          organization_display_name: item.organization_display_name ?? null,
          code: item.code ?? null,
          aggregator_code: item.aggregator_code ?? null,
          aggregator_name: item.aggregator_name ?? null,
        };
        pageMerged += 1;
      }
      merged += pageMerged;
      done += 1;
      if (done % 50 === 0 || done === lastPage) {
        console.log(`  ${done}/${lastPage} pagine · snapshot JSON: ${merged}`);
      }
    });
  }
  return merged;
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
  if (response.status === 404) {
    return { xml: '', total: 0, pages: 0, page };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pagina ${page} (${entityType}/${federationType ?? '-'})`);
  }
  return {
    xml: await response.text(),
    total: Number(response.headers.get('tot-metadata') || 0),
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
  if (response.status === 404) {
    return { items: [], pages: 0 };
  }
  if (!response.ok) {
    throw new Error(`JSON HTTP ${response.status} pagina ${page}`);
  }
  const body = await response.json();
  const items = Array.isArray(body) ? body : body?.items ?? [];
  const pages = Number(response.headers.get('tot-pages') || 0);
  return { items, pages };
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

async function countDistinctEntityIds(params, pageSize, lastPage) {
  const ids = new Set();
  const pages = Array.from({ length: lastPage }, (_, i) => i + 1);
  let done = 0;
  await runPool(pages, FETCH_CONCURRENCY, async (page) => {
    const batch = await fetchJsonPage({ ...params, page, pageSize });
    for (const item of batch.items) {
      if (item?.entity_id) ids.add(item.entity_id);
    }
    done += 1;
    if (done % 20 === 0 || done === lastPage) {
      console.log(
        `  probe ${params.entityType}/${params.federationType ?? '-'}: ${done}/${lastPage} pagine`,
      );
    }
  });
  return ids.size;
}

async function probeRegistryTotals() {
  const byQuery = {};
  for (const { key, params } of PROBE_QUERIES) {
    console.log(`Probe totali: ${key}`);
    const pages = await findLastJsonPage(params);
    const entityCount = await countDistinctEntityIds(params, 50, pages);
    byQuery[key] = {
      entityCount,
      pages,
      source: 'build-script',
      updatedAt: new Date().toISOString(),
    };
    console.log(`  → ${entityCount} entity ID, ${pages} pagine`);
  }
  return { version: 1, byQuery };
}

function ingestXmlPageBuild(entries, scope, entityType, xml) {
  const parsed = parseAllFromBundle(xml);
  let withExtensions = 0;
  let count = 0;
  for (const item of parsed) {
    if (!item?.entityId) continue;
    count += 1;
    const pro =
      entityType === 'IDP'
        ? (item.purposes || []).some((p) => PROFESSIONAL_PURPOSES.has(p))
        : item.hasProfessionalAcs;
    if (item.hasAgeLimit || item.supportedAgeLimit || item.hasAcs77 || item.hasEidasAcs || pro) {
      withExtensions += 1;
    }
    entries[item.entityId] = {
      entityId: item.entityId,
      entityType: scope,
      scannedAt: item.scannedAt,
      flags: flagsFromParsed(item, scope),
      ageLimits: item.ageLimits,
      purposes: item.purposes,
    };
  }
  return { count, withExtensions };
}

async function scanLayer(layer, entries, scans) {
  const { entityType, federationType, scope, label } = layer;
  console.log(`\n=== ${label} · ${FETCH_CONCURRENCY} workers ===`);

  const totalPages = await detectXmlPageCount(
    (p) => fetchPageXml(p),
    { entityType, federationType },
  );

  console.log(`Pagine da scaricare: ${totalPages}`);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  let processed = 0;
  let withExtensions = 0;
  let errors = 0;
  let done = 0;

  await runPool(pages, FETCH_CONCURRENCY, async (page) => {
    try {
      const { xml } = await fetchPageXml({ entityType, federationType, page });
      const { count, withExtensions: ext } = ingestXmlPageBuild(entries, scope, entityType, xml);
      processed += count;
      withExtensions += ext;
      done += 1;
      if (done % 20 === 0 || done === totalPages) {
        console.log(
          `  ${done}/${totalPages} pagine · +${count} entity (pag. ${page}) · cache ${Object.keys(entries).length}`,
        );
      }
    } catch (err) {
      errors += 1;
      console.warn(`  errore pagina ${page}: ${err.message}`);
    }
  });

  const scanKey = `scan-${scope}`;
  scans[scanKey] = {
    scope: scanKey,
    listMode: scope,
    aborted: false,
    processed,
    withExtensions,
    errors,
    registryPagesTotal: totalPages,
    registryEntityTotal: processed,
    cacheTotal: Object.keys(entries).length,
    completedAt: new Date().toISOString(),
  };

  return { entityCount: processed, pages: totalPages, scope };
}

function rebuildIdpSupportedAgeLimit(entries) {
  const entityIds = Object.values(entries)
    .filter((e) => e.entityType === 'IDP' && e.flags?.supportedAgeLimit)
    .map((e) => e.entityId);
  return {
    entityIds,
    scannedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log(`Build cache metadata SPID Registry Navigator · pool=${FETCH_CONCURRENCY}\n`);

  const entries = {};
  const scans = {};

  for (const layer of LAYERS) {
    await scanLayer(layer, entries, scans);
  }

  console.log('\nSnapshot JSON API (solo confronto asimmetrie, non filtri)…');
  const jsonSnapshots = await mergeRegistryJsonSnapshot(entries);
  console.log(`  → ${jsonSnapshots} entity ID con registryJson`);

  const filterCounts = countFilterFlags(entries);
  console.log('\nConteggi filtri da XML:', JSON.stringify(filterCounts, null, 2));

  const idpSupportedAgeLimit = rebuildIdpSupportedAgeLimit(entries);
  const total = Object.keys(entries).length;

  scans['scan-FULL'] = {
    scope: 'scan-FULL',
    listMode: 'SP',
    aborted: false,
    processed: total,
    registryEntityTotal: total,
    cacheTotal: total,
    completedAt: new Date().toISOString(),
  };

  const cacheBundle = {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    source: 'spid-registry-navigator',
    description:
      'Cache predefinita: metadata XML completo; flag filtri (minori, firma, professionale, eIDAS) solo da XML',
    version: 1,
    filterCounts,
    entries,
    idpSupportedAgeLimit,
    scans,
  };

  mkdirSync(dirname(OUT_CACHE), { recursive: true });
  writeFileSync(OUT_CACHE, JSON.stringify(cacheBundle));
  console.log(`\nCache scritta: ${OUT_CACHE} (${total} entity ID)`);

  console.log('\nProbe totali registry (JSON API)…');
  const registryTotals = await probeRegistryTotals();
  writeFileSync(OUT_TOTALS, JSON.stringify(registryTotals, null, 2));
  console.log(`Totali scritti: ${OUT_TOTALS}`);

  console.log('\nCompletato.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
