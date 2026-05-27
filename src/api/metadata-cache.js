import { baseUrl } from '../lib/base-url.js';
import { CACHE_KEY, CACHE_TTL_MS, DEFAULT_CACHE_PATH } from './constants.js';
import { PROFESSIONAL_PURPOSES } from './constants.js';
import { getEntityAsymmetries } from './entity-consistency.js';
import { cacheEntryHasAnyExtension, cacheEntryHasExtension } from './extension-xml.js';
import {
  getBundledVersionMarker,
  isIndexedDbAvailable,
  loadStoreFromIdb,
  saveStoreToIdb,
  setBundledVersionMarker,
} from './metadata-cache-storage.js';

function emptyStore() {
  return {
    version: 1,
    entries: {},
    idpSupportedAgeLimit: { entityIds: [], scannedAt: null },
    scans: {},
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return emptyStore();
    const data = JSON.parse(raw);
    if (!data.entries) return emptyStore();
    return { ...emptyStore(), ...data, entries: data.entries || {} };
  } catch {
    return emptyStore();
  }
}

function saveStoreLegacyLocal(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      throw new Error('Cache metadata troppo grande per localStorage del browser');
    }
    throw err;
  }
}

function normalizeStore(data) {
  if (!data || typeof data !== 'object') return emptyStore();
  return {
    ...emptyStore(),
    version: data.version ?? 1,
    entries: data.entries && typeof data.entries === 'object' ? data.entries : {},
    idpSupportedAgeLimit: {
      ...emptyStore().idpSupportedAgeLimit,
      ...(data.idpSupportedAgeLimit || {}),
    },
    scans: data.scans && typeof data.scans === 'object' ? data.scans : {},
  };
}

function applyStore(data) {
  store = normalizeStore(data);
  persist();
}

let store = emptyStore();
let initPromise = null;
let persistTimer = null;
const listeners = new Set();

/** Carica cache da IndexedDB (o migra da localStorage). Da chiamare prima dell’app. */
export async function initMetadataCache() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (isIndexedDbAvailable()) {
      const fromIdb = await loadStoreFromIdb();
      if (fromIdb?.entries) {
        store = normalizeStore(fromIdb);
        return;
      }
    }
    const legacy = loadStore();
    if (Object.keys(legacy.entries).length > 0) {
      store = legacy;
      await flushPersist();
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    store = emptyStore();
  })();
  return initPromise;
}

export function subscribeCache(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((fn) => fn(store));
}

async function flushPersist() {
  if (isIndexedDbAvailable()) {
    await saveStoreToIdb(store);
    return;
  }
  saveStoreLegacyLocal(store);
}

function persist() {
  notify();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    flushPersist().catch((err) => {
      console.warn('Persistenza cache non riuscita:', err);
    });
  }, 150);
}

export function getCacheStats() {
  const entries = Object.values(store.entries);
  const fresh = entries.filter((e) => !isStale(e)).length;
  const withMinori = entries.filter((e) => cacheEntryHasExtension(e, 'minori')).length;
  const withFirma = entries.filter((e) => cacheEntryHasExtension(e, 'firma')).length;
  const withProfessionale = entries.filter((e) =>
    cacheEntryHasExtension(e, 'professionale'),
  ).length;
  const withEidas = entries.filter((e) => cacheEntryHasExtension(e, 'eidas')).length;
  const withExtensions = entries.filter((e) => cacheEntryHasAnyExtension(e)).length;

  const byType = { IDP: 0, SP: 0, AG: 0 };
  const minoriByType = { IDP: 0, SP: 0, AG: 0 };
  const firmaByType = { IDP: 0, SP: 0, AG: 0 };
  const professionaleByType = { IDP: 0, SP: 0, AG: 0 };
  const freshByType = { IDP: 0, SP: 0, AG: 0 };

  for (const entry of entries) {
    const type = entry.entityType;
    if (!(type in byType)) continue;
    byType[type] += 1;
    if (cacheEntryHasExtension(entry, 'minori')) minoriByType[type] += 1;
    if (cacheEntryHasExtension(entry, 'firma')) firmaByType[type] += 1;
    if (cacheEntryHasExtension(entry, 'professionale')) professionaleByType[type] += 1;
    if (!isStale(entry)) freshByType[type] += 1;
  }

  return {
    total: entries.length,
    fresh,
    stale: entries.length - fresh,
    withMinori,
    withFirma,
    withProfessionale,
    withEidas,
    withExtensions,
    byType,
    minoriByType,
    firmaByType,
    professionaleByType,
    freshByType,
    idpSupportedAgeLimit: store.idpSupportedAgeLimit?.entityIds?.length || 0,
    idpScannedAt: store.idpSupportedAgeLimit?.scannedAt,
  };
}

export function isStale(entry) {
  if (!entry?.scannedAt) return true;
  return Date.now() - new Date(entry.scannedAt).getTime() > CACHE_TTL_MS;
}

/**
 * @param {import('./metadata-xml.js').parseEntityDescriptor extends Function ? ReturnType<import('./metadata-xml.js').parseEntityDescriptor> : never} parsed
 * @param {'IDP'|'SP'|'AG'} entityType
 */
export function flagsFromParsed(parsed, entityType) {
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

export function mergeRegistryJson(entityId, jsonFields) {
  const entry = store.entries[entityId];
  if (!entry || !jsonFields) return;
  entry.registryJson = { ...(entry.registryJson || {}), ...jsonFields };
}

/** @param {string} [canonicalEntityId] entity_id del registry (chiave in cache) */
export function upsertParsedMetadata(parsed, entityType, canonicalEntityId) {
  const entityId = canonicalEntityId || parsed.entityId;
  if (!entityId) return null;

  if (
    canonicalEntityId &&
    parsed.entityId &&
    parsed.entityId !== canonicalEntityId &&
    store.entries[parsed.entityId]
  ) {
    delete store.entries[parsed.entityId];
  }

  const entry = {
    entityId,
    entityType,
    scannedAt: parsed.scannedAt || new Date().toISOString(),
    flags: flagsFromParsed(parsed, entityType),
    ageLimits: parsed.ageLimits,
    purposes: parsed.purposes,
  };

  store.entries[entityId] = entry;
  persist();
  return entry;
}

/**
 * @returns {{ written: number, cacheTotal: number, cacheForType: number }}
 */
export function upsertMany(parsedList, entityType) {
  let written = 0;
  for (const parsed of parsedList) {
    if (!parsed?.entityId) continue;
    store.entries[parsed.entityId] = {
      entityId: parsed.entityId,
      entityType,
      scannedAt: parsed.scannedAt || new Date().toISOString(),
      flags: flagsFromParsed(parsed, entityType),
      ageLimits: parsed.ageLimits,
      purposes: parsed.purposes,
    };
    written += 1;
  }
  if (written) persist();
  return {
    written,
    cacheTotal: Object.keys(store.entries).length,
    cacheForType: Object.values(store.entries).filter((e) => e.entityType === entityType).length,
  };
}

export function setIdpSupportedAgeLimit(entityIds) {
  store.idpSupportedAgeLimit = {
    entityIds: [...entityIds],
    scannedAt: new Date().toISOString(),
  };
  persist();
}

export function getIdpSupportedAgeLimitSet() {
  return new Set(store.idpSupportedAgeLimit?.entityIds || []);
}

export function getCachedEntry(entityId) {
  return store.entries[entityId] || null;
}

/**
 * @param {{ entityType?: string, extensions?: ('minori'|'firma'|'professionale'|'eidas')[] }} opts
 */
export function getCachedEntriesByFilter({ entityType, extensions } = {}) {
  return Object.values(store.entries).filter((entry) => {
    if (entityType && entry.entityType !== entityType) return false;
    if (extensions?.length) {
      return extensions.every((ext) => cacheEntryHasExtension(entry, ext));
    }
    return true;
  });
}

/** Skeleton per la lista quando si ha solo la cache (XML + eventuale JSON incorporato). */
export function cacheEntryToListEntity(entry) {
  const json = entry.registryJson || {};
  return {
    entity_id: entry.entityId,
    organization_name: json.organization_name ?? null,
    organization_display_name: json.organization_display_name ?? null,
    code: json.code ?? null,
    eidas_ready: json.eidas_ready ?? null,
    aggregator_code: json.aggregator_code ?? null,
    aggregator_name: json.aggregator_name ?? null,
    federation_type: entry.entityType === 'AG' ? 'AG' : entry.entityType,
    _fromCacheOnly: true,
  };
}

export function recordScan(scopeKey, meta) {
  store.scans[scopeKey] = {
    ...meta,
    completedAt: new Date().toISOString(),
  };
  persist();
}

export function getLastScan(scopeKey) {
  return store.scans[scopeKey] || null;
}

export function rebuildIdpSupportedAgeLimitFromCache() {
  const ids = Object.values(store.entries)
    .filter((e) => e.entityType === 'IDP' && e.flags?.supportedAgeLimit)
    .map((e) => e.entityId);
  setIdpSupportedAgeLimit(ids);
  return ids;
}

export function enrichEntity(entity, entityType) {
  const cached = getCachedEntry(entity.entity_id);
  const json = cached?.registryJson;
  const merged = {
    ...entity,
    ...(json?.eidas_ready && !entity.eidas_ready ? { eidas_ready: json.eidas_ready } : {}),
    ...(json?.organization_name && !entity.organization_name
      ? { organization_name: json.organization_name }
      : {}),
    ...(json?.organization_display_name && !entity.organization_display_name
      ? { organization_display_name: json.organization_display_name }
      : {}),
    ...(json?.aggregator_code && !entity.aggregator_code
      ? { aggregator_code: json.aggregator_code }
      : {}),
    ...(json?.aggregator_name && !entity.aggregator_name
      ? { aggregator_name: json.aggregator_name }
      : {}),
    _cache: cached,
    _minoriSource: cached
      ? cached.flags.minoriXml
        ? 'xml'
        : 'xml-negative'
      : null,
  };
  merged._asymmetries = getEntityAsymmetries(merged, entityType, cached);
  return merged;
}

export function isCacheEmpty() {
  return Object.keys(store.entries).length === 0;
}

export function exportCacheBundle() {
  return {
    bundleVersion: 1,
    exportedAt: new Date().toISOString(),
    source: 'spid-saml2-federation-search-engine',
    version: store.version,
    entries: store.entries,
    idpSupportedAgeLimit: store.idpSupportedAgeLimit,
    scans: store.scans,
  };
}

/**
 * @param {object} data
 * @param {{ mode?: 'merge'|'replace' }} [opts]
 */
export function importCacheBundle(data, opts = {}) {
  const mode = opts.mode || 'merge';
  const incoming = normalizeStore(data);

  if (mode === 'replace') {
    applyStore(incoming);
    rebuildIdpSupportedAgeLimitFromCache();
    return {
      mode,
      total: Object.keys(store.entries).length,
      added: Object.keys(incoming.entries).length,
      updated: 0,
    };
  }

  let added = 0;
  let updated = 0;

  for (const [id, entry] of Object.entries(incoming.entries)) {
    const existing = store.entries[id];
    if (!existing) {
      store.entries[id] = entry;
      added += 1;
      continue;
    }
    const existingTs = new Date(existing.scannedAt || 0).getTime();
    const incomingTs = new Date(entry.scannedAt || 0).getTime();
    if (incomingTs >= existingTs) {
      store.entries[id] = entry;
      updated += 1;
    }
  }

  if (incoming.idpSupportedAgeLimit?.entityIds?.length) {
    const merged = new Set([
      ...(store.idpSupportedAgeLimit?.entityIds || []),
      ...incoming.idpSupportedAgeLimit.entityIds,
    ]);
    store.idpSupportedAgeLimit = {
      entityIds: [...merged],
      scannedAt: new Date().toISOString(),
    };
  }

  for (const [key, scan] of Object.entries(incoming.scans || {})) {
    const current = store.scans[key];
    if (!current) {
      store.scans[key] = scan;
      continue;
    }
    const curTs = new Date(current.completedAt || 0).getTime();
    const inTs = new Date(scan.completedAt || 0).getTime();
    if (inTs >= curTs) store.scans[key] = scan;
  }

  rebuildIdpSupportedAgeLimitFromCache();

  return {
    mode,
    total: Object.keys(store.entries).length,
    added,
    updated,
  };
}

export async function fetchBundledDefaultCache() {
  const res = await fetch(baseUrl(DEFAULT_CACHE_PATH));
  if (!res.ok) {
    throw new Error(`Cache predefinita non trovata (${res.status})`);
  }
  return res.json();
}

export async function importBundledDefaultCache() {
  const data = await fetchBundledDefaultCache();
  return importCacheBundle(data, { mode: 'replace' });
}

/**
 * All’avvio carica la cache predefinita del progetto in IndexedDB se assente o incompleta.
 * @returns {Promise<{ loaded: boolean, total?: number, reason?: string, error?: string }>}
 */
export async function ensureBundledCache() {
  await initMetadataCache();

  try {
    const bundled = await fetchBundledDefaultCache();
    const bundledCount = Object.keys(bundled.entries || {}).length;
    if (!bundledCount) {
      return { loaded: false, reason: 'bundle-empty' };
    }

    const currentCount = Object.keys(store.entries).length;
    const bundledAt = bundled.exportedAt || bundled.generatedAt || '';
    const storedAt = await getBundledVersionMarker();
    const incomplete = currentCount < bundledCount * 0.9;
    const outdated = Boolean(bundledAt && storedAt && bundledAt > storedAt);
    const empty = currentCount === 0;

    if (!empty && !incomplete && !outdated) {
      return { loaded: false, reason: 'already-current', total: currentCount };
    }

    applyStore(bundled);
    await flushPersist();
    if (bundledAt) await setBundledVersionMarker(bundledAt);

    return {
      loaded: true,
      total: Object.keys(store.entries).length,
      reason: empty ? 'imported-bundle' : incomplete ? 'replaced-incomplete' : 'replaced-outdated',
    };
  } catch (err) {
    if (/non trovata/i.test(String(err.message))) {
      return { loaded: false, reason: 'bundle-missing', error: err.message };
    }
    return { loaded: false, reason: 'import-failed', error: err.message };
  }
}

/** @deprecated usare ensureBundledCache */
export const ensureDefaultCache = ensureBundledCache;
