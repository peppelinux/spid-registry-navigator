import { baseUrl } from '../lib/base-url.js';
import { DEFAULT_REGISTRY_TOTALS_PATH, REGISTRY_TOTALS_KEY } from './constants.js';
import { fetchEntities, RegistryApiError } from './registry.js';

function cacheKey(params) {
  return `${params.entityType}|${params.federationType ?? ''}|${params.aggregatorCode ?? ''}`;
}

function loadTotalsStore() {
  try {
    const raw = localStorage.getItem(REGISTRY_TOTALS_KEY);
    if (!raw) return { version: 1, byQuery: {} };
    const data = JSON.parse(raw);
    return {
      version: 1,
      byQuery: data.byQuery && typeof data.byQuery === 'object' ? data.byQuery : {},
    };
  } catch {
    return { version: 1, byQuery: {} };
  }
}

function saveTotalsStore(data) {
  localStorage.setItem(REGISTRY_TOTALS_KEY, JSON.stringify(data));
}

function normalizeProbeResult(data) {
  if (!data) return null;
  const entityCount = data.entityCount ?? data.total ?? null;
  return {
    entityCount,
    /** @deprecated usare entityCount */
    total: entityCount,
    pages: data.pages ?? null,
    source: data.source ?? null,
    updatedAt: data.updatedAt ?? null,
  };
}

function readCache(key) {
  const store = loadTotalsStore();
  const entry = store.byQuery[key];
  if (!entry) return null;
  return normalizeProbeResult(entry);
}

function writeCache(key, value) {
  const store = loadTotalsStore();
  store.byQuery[key] = {
    entityCount: value.entityCount,
    pages: value.pages,
    source: value.source ?? 'api-probe',
    updatedAt: new Date().toISOString(),
  };
  saveTotalsStore(store);
}

/** Salva totali noti da una scansione XML (senza nuovo probe API). */
export function saveRegistryTotalsFromScan(params, { entityCount, pages }) {
  if (entityCount == null || pages == null) return;
  writeCache(cacheKey(params), {
    entityCount,
    pages,
    source: 'scan',
  });
}

export function invalidateRegistryTotalsCache() {
  localStorage.removeItem(REGISTRY_TOTALS_KEY);
}

export function hasFreshRegistryTotals() {
  const store = loadTotalsStore();
  return REGISTRY_PROBE_QUERIES.every(({ params }) => {
    const entry = store.byQuery[cacheKey(params)];
    return entry?.entityCount != null && entry?.pages != null;
  });
}

/** Importa totali registry dal bundle in public/data/ se localStorage è incompleto. */
export async function ensureBundledRegistryTotals() {
  if (hasFreshRegistryTotals()) {
    return { loaded: false, reason: 'already-fresh' };
  }
  try {
    const res = await fetch(baseUrl(DEFAULT_REGISTRY_TOTALS_PATH));
    if (!res.ok) {
      return { loaded: false, reason: 'bundle-missing', status: res.status };
    }
    const incoming = await res.json();
    if (!incoming?.byQuery || !Object.keys(incoming.byQuery).length) {
      return { loaded: false, reason: 'bundle-empty' };
    }
    const store = loadTotalsStore();
    let merged = 0;
    for (const [key, entry] of Object.entries(incoming.byQuery)) {
      const current = store.byQuery[key];
      if (current?.entityCount != null && current?.pages != null) continue;
      store.byQuery[key] = {
        entityCount: entry.entityCount,
        pages: entry.pages,
        source: entry.source ?? 'bundled-default',
        updatedAt: entry.updatedAt ?? new Date().toISOString(),
      };
      merged += 1;
    }
    if (merged) saveTotalsStore(store);
    return {
      loaded: merged > 0 || hasFreshRegistryTotals(),
      merged,
      reason: merged ? 'imported-bundle' : 'no-merge-needed',
    };
  } catch (err) {
    return { loaded: false, reason: 'error', error: err.message };
  }
}

/** Oltre l’ultima pagina il registry risponde 404, non un array vuoto. */
async function fetchProbePage(params, page, pageSize, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  try {
    return await fetchEntities({ ...params, page, pageSize });
  } catch (err) {
    if (err instanceof RegistryApiError && err.status === 404) {
      return {
        items: [],
        total: 0,
        pages: 0,
        page,
        paginationExact: true,
        paginationFromHeaders: false,
      };
    }
    throw err;
  }
}

function entityIdsFromItems(items) {
  const ids = new Set();
  for (const item of items) {
    const id = item?.entity_id;
    if (id) ids.add(id);
  }
  return ids;
}

async function findLastApiPage(params, pageSize, signal) {
  const first = await fetchProbePage(params, 1, pageSize, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const firstCount = first.items.length;
  if (firstCount === 0) return 1;
  if (firstCount < pageSize) return 1;

  let lastFull = 1;
  let probePage = 2;

  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const batch = await fetchProbePage(params, probePage, pageSize, signal);
    const count = batch.items.length;
    if (count === 0) break;

    if (count < pageSize) return probePage;

    lastFull = probePage;
    probePage *= 2;
    if (probePage > 50_000) {
      throw new Error('Limite pagine superato durante il conteggio');
    }
  }

  let lo = lastFull + 1;
  let hi = probePage - 1;

  while (lo < hi) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const mid = Math.floor((lo + hi + 1) / 2);
    const batch = await fetchProbePage(params, mid, pageSize, signal);
    if (batch.items.length > 0) lo = mid;
    else hi = mid - 1;
  }

  return lo;
}

async function countDistinctEntityIds(params, pageSize, lastPage, signal) {
  const allIds = new Set();

  for (let page = 1; page <= lastPage; page += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const batch = await fetchProbePage(params, page, pageSize, signal);
    for (const id of entityIdsFromItems(batch.items)) {
      allIds.add(id);
    }
  }

  return allIds.size;
}

export async function probeEntityPagination(params, pageSize = 50, signal) {
  const key = cacheKey(params);
  const cached = readCache(key);
  if (cached) return cached;

  const lastPage = await findLastApiPage(params, pageSize, signal);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const entityCount = await countDistinctEntityIds(params, pageSize, lastPage, signal);

  const result = { entityCount, pages: lastPage, total: entityCount };
  writeCache(key, { ...result, source: 'api-probe' });
  return result;
}

export function getCachedPagination(params) {
  return readCache(cacheKey(params));
}

export function clearPaginationCache() {
  invalidateRegistryTotalsCache();
}

export const REGISTRY_PROBE_QUERIES = [
  { label: 'IdP', params: { entityType: 'IDP', federationType: null, aggregatorCode: null } },
  {
    label: 'SP (non aggregati)',
    params: { entityType: 'SP', federationType: 'SP', aggregatorCode: null },
  },
  {
    label: 'Aggregati',
    params: { entityType: 'SP', federationType: 'AG', aggregatorCode: null },
  },
];

export async function ensureAllRegistryTotals(signal, onProgress) {
  if (hasFreshRegistryTotals()) {
    onProgress?.(REGISTRY_PROBE_QUERIES.length, REGISTRY_PROBE_QUERIES.length);
    return;
  }

  const pending = REGISTRY_PROBE_QUERIES.filter(({ params }) => !readCache(cacheKey(params)));
  let done = REGISTRY_PROBE_QUERIES.length - pending.length;

  onProgress?.(done, REGISTRY_PROBE_QUERIES.length);

  for (const { params } of pending) {
    if (signal?.aborted) break;
    await probeEntityPagination(params, 50, signal);
    done += 1;
    onProgress?.(done, REGISTRY_PROBE_QUERIES.length);
  }
}

export function getRegistryTotalsSnapshot() {
  const store = loadTotalsStore();

  const rows = REGISTRY_PROBE_QUERIES.map(({ label, params, note }) => {
    const entry = store.byQuery[cacheKey(params)];
    return {
      label,
      note,
      entityCount: entry?.entityCount ?? null,
      pages: entry?.pages ?? null,
    };
  });

  const sp = store.byQuery[cacheKey(REGISTRY_PROBE_QUERIES[1].params)];
  const ag = store.byQuery[cacheKey(REGISTRY_PROBE_QUERIES[2].params)];
  rows.push({
    label: 'Tutti gli SP (entity ID)',
    note: 'SP non aggregati + aggregati',
    entityCount: sp && ag ? sp.entityCount + ag.entityCount : null,
    pages: sp && ag ? sp.pages + ag.pages : null,
  });

  return rows;
}
