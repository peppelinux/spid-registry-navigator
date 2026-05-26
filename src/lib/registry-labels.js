/**
 * Terminologia registry (coerente in tutta l’UI):
 *
 * - **entity ID** — soggetto nel registro (`entityID` / `entity_id`), uno per EntityDescriptor.
 * - **pagina API** — risposta XML/JSON paginata (`page`, `numMetadata`); contiene un bundle con
 *   molti entity ID (fino a ~50 metadata per richiesta), non un solo entity ID.
 * - **tot-metadata** (header HTTP) — conteggio documenti metadata nel registro, NON usare come
 *   sinonimo di entity ID (spesso ≠ entity ID distinti).
 */

const KIND = {
  IDP: { one: 'IdP', many: 'IdP', registry: 'IdP' },
  SP: { one: 'SP', many: 'SP (non aggregati)', registry: 'SP (non aggregati)' },
  AG: { one: 'aggregato', many: 'aggregati', registry: 'aggregati' },
};

export function formatCount(n) {
  return Number(n ?? 0).toLocaleString('it-IT');
}

/** N entity ID distinti nel registro o in cache. */
export function labelEntityIds(n) {
  const c = formatCount(n);
  return n === 1 ? '1 entity ID' : `${c} entity ID`;
}

export function labelEntityIdsInCache(n) {
  return `${labelEntityIds(n)} in cache`;
}

export function labelEntityIdsInRegistry(kindLabel, n) {
  return `${labelEntityIds(n)} ${kindLabel} nel registro`;
}

/** Entity ID estratti da un singolo bundle XML (una pagina API). */
export function labelEntityIdsOnApiBundle(n) {
  return `${labelEntityIds(n)} nel bundle XML (questa pagina API)`;
}

export function labelEntityIdsAnalyzedThisScan(n) {
  return `${labelEntityIds(n)} analizzati in questa scansione`;
}

export function labelApiPages(n) {
  const c = formatCount(n);
  return n === 1 ? '1 pagina API' : `${c} pagine API`;
}

export function labelExportedCache(n) {
  return `Esportati ${labelEntityIds(n)} distinti dalla cache locale`;
}

export function labelImportedCache({ added, updated, total }) {
  return `Importati ${formatCount(added)} nuovi, ${formatCount(updated)} aggiornati (${labelEntityIds(total)} in cache)`;
}

export function registryKind(mode) {
  return KIND[mode] || KIND.SP;
}

export function registryKindOne(mode) {
  return registryKind(mode).one;
}

export function registryKindMany(mode) {
  return registryKind(mode).many;
}

export function registryKindRegistry(mode) {
  return registryKind(mode).registry;
}

/** @param {'IDP'|'SP'|'AG'} entityType @param {string|null} [federationType] */
export function modeFromEntityType(entityType, federationType) {
  if (entityType === 'IDP') return 'IDP';
  if (federationType === 'AG') return 'AG';
  return 'SP';
}

export function modeFromScanScope(scope, listMode) {
  if (scope === 'page') return listMode || 'SP';
  if (scope === 'IDP') return 'IDP';
  if (scope === 'AG') return 'AG';
  if (scope === 'ALL') return 'SP';
  return 'SP';
}
