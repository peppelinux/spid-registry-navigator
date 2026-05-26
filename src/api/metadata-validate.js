import {
  getCachedEntry,
  isStale,
  rebuildIdpSupportedAgeLimitFromCache,
  upsertParsedMetadata,
} from './metadata-cache.js';
import { cacheEntryHasAnyExtension } from './extension-xml.js';
import { fetchEntityXml, parseEntityMetadataXml } from './metadata-xml.js';

export function yieldToMain() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function shortEntityId(entityId) {
  if (!entityId || entityId.length <= 56) return entityId;
  return `…${entityId.slice(-52)}`;
}

function emit(onProgress, payload) {
  onProgress?.(payload);
}

function checkAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('Validazione interrotta', 'AbortError');
  }
}

/**
 * @param {string} entityId
 * @param {'IDP'|'SP'|'AG'} entityType
 * @param {function} [onProgress]
 * @param {AbortSignal} [signal]
 * @param {{ forceRefresh?: boolean }} [options] — se true, scarica sempre XML dal registry
 */
export async function validateSingleEntity(
  entityId,
  entityType,
  onProgress,
  signal,
  options = {},
) {
  const { forceRefresh = false } = options;
  const label = shortEntityId(entityId);

  if (!forceRefresh) {
    emit(onProgress, {
      type: 'step',
      step: 'cache',
      message: `Verifica cache: ${label}`,
      percent: 10,
      indeterminate: false,
    });
    await yieldToMain();
    checkAborted(signal);
  }

  const cached = !forceRefresh ? getCachedEntry(entityId) : null;
  if (cached && !isStale(cached)) {
    emit(onProgress, {
      type: 'step',
      step: 'done',
      message: 'Risultato da cache (<24h), nessun download',
      percent: 100,
    });
    emit(onProgress, {
      type: 'entity',
      entityId,
      entitiesProcessed: 1,
      registryEntityTotal: 1,
      hasExtensions: cacheEntryHasAnyExtension(cached),
    });
    return { ...cached, fromCache: true };
  }

  emit(onProgress, {
    type: 'step',
    step: 'fetch',
    message: forceRefresh
      ? `Download metadata XML fresco dal registry: ${label}`
      : `Download metadata XML: ${label}`,
    percent: 30,
    indeterminate: true,
  });
  await yieldToMain();
  checkAborted(signal);

  const xml = await fetchEntityXml(entityId, signal);
  checkAborted(signal);

  emit(onProgress, {
    type: 'step',
    step: 'parse',
    message: 'Parsing metadata ed estensioni…',
    percent: 65,
    indeterminate: false,
  });
  await yieldToMain();
  checkAborted(signal);

  const parsed = parseEntityMetadataXml(xml, entityId);
  if (!parsed) {
    throw new Error('Metadata non trovato nel XML');
  }

  emit(onProgress, {
    type: 'step',
    step: 'save',
    message: 'Salvataggio in cache locale…',
    percent: 85,
  });
  await yieldToMain();
  checkAborted(signal);

  const entry = upsertParsedMetadata(parsed, entityType, entityId);
  if (!entry) {
    throw new Error('Salvataggio in cache non riuscito');
  }
  if (entityType === 'IDP') {
    rebuildIdpSupportedAgeLimitFromCache();
  }
  const hasExt = cacheEntryHasAnyExtension(entry);

  emit(onProgress, {
    type: 'step',
    step: 'done',
    message: hasExt
      ? 'Completato — metadata aggiornato, estensioni rilevate'
      : 'Completato — metadata aggiornato, nessuna estensione rilevata',
    percent: 100,
  });
  emit(onProgress, {
    type: 'entity',
    entityId,
    entitiesProcessed: 1,
    registryEntityTotal: 1,
    hasExtensions: hasExt,
  });

  return { ...entry, fromCache: false };
}
