/**
 * I filtri estensione SPID sono autoritativi solo se derivati dal metadata XML
 * analizzato e presente in cache (un EntityDescriptor = un entity ID).
 */
import { cacheEntryHasExtension } from './extension-xml.js';
import { getCacheStats, getCachedEntry } from './metadata-cache.js';

export const XML_EXTENSION_KEYS = ['minori', 'firma', 'professionale', 'eidas'];

/** Copertura minima cache vs registry per considerare i filtri affidabili. */
export const CACHE_COVERAGE_THRESHOLD = 0.9;

/**
 * @param {'IDP'|'SP'|'AG'} entityType
 * @param {number} [expectedInRegistry]
 */
export function getCacheCoverage(entityType, expectedInRegistry) {
  const stats = getCacheStats();
  const cached = stats.byType[entityType] ?? 0;
  const expected = expectedInRegistry ?? cached;
  const ratio = expected > 0 ? cached / expected : cached > 0 ? 1 : 0;
  return {
    entityType,
    cached,
    expected,
    ratio,
    complete: expected > 0 ? ratio >= CACHE_COVERAGE_THRESHOLD : cached > 0,
  };
}

/**
 * @param {'IDP'|'SP'|'AG'} entityType
 * @param {number} [expectedInRegistry]
 */
export function isAuthoritativeCacheForType(entityType, expectedInRegistry) {
  return getCacheCoverage(entityType, expectedInRegistry).complete;
}

/**
 * Match filtro estensione: solo flag XML in cache (nessuna euristica JSON).
 * @param {object|null|undefined} entity
 * @param {'IDP'|'SP'|'AG'} entityType
 * @param {'minori'|'firma'|'professionale'|'eidas'} ext
 */
export function matchesExtensionFromXmlCache(entity, entityType, ext) {
  const cached = getCachedEntry(entity?.entity_id);
  if (!cached) return false;
  if (ext === 'firma' && entityType === 'IDP') return false;
  if (cached.entityType !== entityType) return false;
  return cacheEntryHasExtension(cached, ext);
}
