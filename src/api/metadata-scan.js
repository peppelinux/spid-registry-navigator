import {
  getCacheStats,
  getLastScan,
  recordScan,
  rebuildIdpSupportedAgeLimitFromCache,
  upsertMany,
} from './metadata-cache.js';
import { parsedHasSpidExtensions } from './extension-xml.js';
import { modeFromScanScope } from '../lib/registry-labels.js';
import {
  getCachedPagination,
  probeEntityPagination,
  saveRegistryTotalsFromScan,
} from './pagination-probe.js';
import { listQueryParams } from './registry.js';
import { yieldToMain } from './metadata-validate.js';
import { fetchPageXml, parseAllFromBundle } from './metadata-xml.js';

const SCOPES = {
  page: { label: 'Pagina corrente', key: (mode) => `page-${mode}` },
  SP: { label: 'Tutti gli SP', entityType: 'SP', federationType: 'SP', key: 'scan-SP' },
  AG: { label: 'Tutti gli aggregati (AG)', entityType: 'SP', federationType: 'AG', key: 'scan-AG' },
  IDP: { label: 'Tutti gli IdP', entityType: 'IDP', federationType: null, key: 'scan-IDP' },
  ALL: { label: 'Tutto il registro SPID', key: 'scan-FULL' },
};

/** Ordine download cache completa: IdP → SP → aggregati (~38k metadata). */
const FULL_REGISTRY_LAYER_SCOPES = ['IDP', 'SP', 'AG'];

export const FULL_REGISTRY_SCAN_KEY = 'scan-FULL';

export function getScanScopes() {
  return SCOPES;
}

let abortController = null;

export function abortScan() {
  abortController?.abort();
  abortController = null;
}

export function isScanRunning() {
  return abortController !== null;
}

/** Avvia un task annullabile (validazione singola o scansione). */
export function createScanSignal() {
  abortScan();
  abortController = new AbortController();
  return abortController.signal;
}

export function releaseScan() {
  abortController = null;
}

async function resolvePagination(entityType, federationType, signal, pageSize = 50) {
  const paginationParams = listQueryParams({ entityType, federationType });
  const cached = getCachedPagination(paginationParams);
  if (cached?.entityCount != null && cached?.pages > 0) return cached;
  return probeEntityPagination(paginationParams, pageSize, signal);
}

/**
 * @param {object} opts
 * @param {'page'|'SP'|'AG'|'IDP'} opts.scope
 * @param {AbortSignal} opts.signal
 * @param {number} [opts.processedOffset] — progresso globale (scansione FULL)
 * @param {number} [opts.registryEntityGrandTotal]
 * @param {string} [opts.layerLabel]
 */
async function runMetadataScanInternal(opts) {
  const { signal } = opts;
  const processedOffset = opts.processedOffset ?? 0;
  const grandTotal = opts.registryEntityGrandTotal;

  const scopeDef =
    opts.scope === 'page'
      ? SCOPES.page
      : SCOPES[opts.scope];

  const entityType =
    opts.scope === 'page'
      ? { IDP: 'IDP', SP: 'SP', AG: 'SP' }[opts.mode]
      : scopeDef.entityType;

  const federationType =
    opts.scope === 'page'
      ? { IDP: null, SP: 'SP', AG: 'AG' }[opts.mode]
      : scopeDef.federationType ?? null;

  const cacheEntityType = opts.scope === 'page' ? opts.mode : opts.scope;

  const scopeKey =
    opts.scope === 'page'
      ? `page-${opts.mode}-${opts.currentPage}`
      : scopeDef.key;

  let totalPages = opts.totalPages || 1;
  let totalEntities = 0;
  let processed = 0;
  let withExtensions = 0;
  let errors = 0;

  const startPage = opts.scope === 'page' ? opts.currentPage : 1;
  const endPage = opts.scope === 'page' ? opts.currentPage : totalPages;

  if (opts.scope !== 'page') {
    opts.onProgress?.({
      type: 'step',
      message: opts.layerLabel
        ? `Conteggio pagine: ${opts.layerLabel}…`
        : 'Conteggio pagine nel registry…',
      indeterminate: true,
    });
    await yieldToMain();

    const counted = await resolvePagination(entityType, federationType, signal);
    if (signal.aborted) return null;
    totalPages = counted.pages;
    totalEntities = counted.entityCount;
  }

  const listMode = modeFromScanScope(opts.scope, opts.mode);
  const entityTotalForProgress = grandTotal ?? totalEntities;

  if (!opts.suppressStartEvent) {
    opts.onProgress?.({
      type: 'start',
      scope: opts.scope,
      scopeLabel: opts.layerLabel || scopeDef.label || `Pagina ${opts.currentPage}`,
      listMode,
      registryPagesTotal: endPage - startPage + 1,
      registryEntityTotal: entityTotalForProgress || totalEntities,
    });
  }

  for (let page = startPage; page <= endPage; page++) {
    if (signal.aborted) break;

    const globalProcessed = processedOffset + processed;

    opts.onProgress?.({
      type: 'page',
      registryPage: page,
      registryPagesTotal: endPage,
      entitiesProcessed: globalProcessed,
      registryEntityTotal: entityTotalForProgress || totalEntities,
      registryLayer: opts.layerLabel,
    });
    opts.onProgress?.({
      type: 'step',
      message: opts.layerLabel
        ? `${opts.layerLabel}: download pagina ${page} / ${endPage}…`
        : `Download pagina ${page} / ${endPage}…`,
      indeterminate: true,
    });
    await yieldToMain();

    try {
      const { xml } = await fetchPageXml({
        entityType,
        federationType,
        page,
        signal,
      });
      if (signal.aborted) break;

      opts.onProgress?.({
        type: 'step',
        message: opts.layerLabel
          ? `${opts.layerLabel}: parsing pagina ${page}…`
          : `Parsing metadata pagina ${page}…`,
        indeterminate: false,
      });
      await yieldToMain();

      const parsed = parseAllFromBundle(xml);

      if (opts.scope === 'page') {
        totalEntities = new Set(parsed.map((p) => p.entityId).filter(Boolean)).size;
      }

      const pageIds = new Set();
      for (const item of parsed) {
        if (signal.aborted) break;
        if (!item?.entityId) continue;

        pageIds.add(item.entityId);
        const hasExt = parsedHasSpidExtensions(item, cacheEntityType);
        if (hasExt) withExtensions += 1;

        opts.onProgress?.({
          type: 'entity',
          entityId: item.entityId,
          registryPage: page,
          entitiesProcessed: processedOffset + processed + pageIds.size,
          registryEntityTotal: entityTotalForProgress || totalEntities || undefined,
          hasExtensions: hasExt,
          registryLayer: opts.layerLabel,
        });

        if (pageIds.size % 3 === 0) {
          await yieldToMain();
        }
      }
      processed += pageIds.size;

      const upsert = upsertMany(parsed, cacheEntityType);
      opts.onProgress?.({
        type: 'pageDone',
        registryPage: page,
        entitiesOnPage: upsert.written,
        entitiesProcessed: processedOffset + processed,
        cacheTotal: upsert.cacheTotal,
        cacheForType: upsert.cacheForType,
        listMode: cacheEntityType,
        registryLayer: opts.layerLabel,
      });
    } catch (err) {
      if (err.name === 'AbortError') break;
      errors += 1;
      opts.onProgress?.({
        type: 'error',
        page,
        message: `Errore lettura pagina ${page}: ${err.message}`,
        registryLayer: opts.layerLabel,
      });
    }
  }

  if (
    !signal.aborted &&
    (opts.scope === 'IDP' || (opts.scope === 'page' && opts.mode === 'IDP'))
  ) {
    rebuildIdpSupportedAgeLimitFromCache();
  }

  const cacheAfter = getCacheStats();
  const result = {
    scope: scopeKey,
    listMode,
    aborted: signal.aborted,
    processed,
    withExtensions,
    errors,
    registryPagesTotal: endPage - startPage + 1,
    registryEntityTotal: totalEntities,
    cacheTotal: cacheAfter.total,
    cacheForType: cacheAfter.byType[listMode] ?? 0,
  };

  if (!signal.aborted && opts.recordScan !== false) {
    recordScan(scopeKey, result);
  }

  if (!signal.aborted && opts.scope !== 'page' && totalEntities > 0 && endPage > 0) {
    saveRegistryTotalsFromScan(
      listQueryParams({ entityType, federationType }),
      { entityCount: totalEntities, pages: endPage },
    );
  }

  return result;
}

/**
 * Scarica tutti i metadata XML del registro (IdP + SP + aggregati) in cache locale.
 */
export async function runFullRegistryCacheBuild(opts) {
  const signal = abortController?.signal ?? createScanSignal();
  const ownsAbort = abortController !== null;

  opts.onProgress?.({
    type: 'step',
    message: 'Conteggio voci nel registro (IdP, SP, aggregati)…',
    indeterminate: true,
  });
  await yieldToMain();

  let grandTotalEntities = 0;
  let grandTotalPages = 0;
  const layerTotals = [];

  for (const layerScope of FULL_REGISTRY_LAYER_SCOPES) {
    if (signal.aborted) return null;
    const def = SCOPES[layerScope];
    const counted = await resolvePagination(def.entityType, def.federationType, signal);
    if (signal.aborted) return null;
    layerTotals.push({ scope: layerScope, ...counted });
    grandTotalEntities += counted.entityCount;
    grandTotalPages += counted.pages;
  }

  let processedOffset = 0;
  let withExtensions = 0;
  let errors = 0;
  let layersCompleted = 0;

  opts.onProgress?.({
    type: 'start',
    scope: 'ALL',
    scopeLabel: SCOPES.ALL.label,
    listMode: 'SP',
    registryPagesTotal: grandTotalPages,
    registryEntityTotal: grandTotalEntities,
  });

  for (const layerScope of FULL_REGISTRY_LAYER_SCOPES) {
    if (signal.aborted) break;

    const def = SCOPES[layerScope];
    const layerResult = await runMetadataScanInternal({
      scope: layerScope,
      signal,
      onProgress: opts.onProgress,
      processedOffset,
      registryEntityGrandTotal: grandTotalEntities,
      layerLabel: def.label,
      suppressStartEvent: true,
      recordScan: true,
    });

    if (!layerResult) break;

    processedOffset += layerResult.processed;
    withExtensions += layerResult.withExtensions;
    errors += layerResult.errors;
    layersCompleted += 1;
  }

  if (!signal.aborted) {
    rebuildIdpSupportedAgeLimitFromCache();
  }

  const cacheAfter = getCacheStats();
  const result = {
    scope: FULL_REGISTRY_SCAN_KEY,
    listMode: 'SP',
    aborted: signal.aborted,
    processed: processedOffset,
    withExtensions,
    errors,
    registryPagesTotal: grandTotalPages,
    registryEntityTotal: grandTotalEntities,
    cacheTotal: cacheAfter.total,
    cacheForType: cacheAfter.total,
    layersCompleted,
  };

  if (!signal.aborted) {
    recordScan(FULL_REGISTRY_SCAN_KEY, result);
  }

  opts.onProgress?.({
    type: 'done',
    ...result,
  });

  if (ownsAbort) abortController = null;
  return result;
}

/**
 * @param {object} opts
 * @param {'page'|'SP'|'AG'|'IDP'|'ALL'} opts.scope
 * @param {string} [opts.mode] - IDP|SP|AG for page scope
 * @param {number} [opts.currentPage]
 * @param {number} [opts.totalPages]
 * @param {function} opts.onProgress
 */
export async function runMetadataScan(opts) {
  if (opts.scope === 'ALL') {
    return runFullRegistryCacheBuild(opts);
  }

  const signal = abortController?.signal ?? createScanSignal();
  const ownsAbort = abortController !== null;

  try {
    const result = await runMetadataScanInternal({ ...opts, signal });
    if (result) {
      opts.onProgress?.({
        type: 'done',
        ...result,
      });
    }
    return result;
  } finally {
    if (ownsAbort) abortController = null;
  }
}

export function formatScanAge(scopeKey) {
  const last = getLastScan(scopeKey);
  if (!last?.completedAt) return null;
  return new Date(last.completedAt).toLocaleString('it-IT');
}
