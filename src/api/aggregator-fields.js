import { baseUrl } from '../lib/base-url.js';

/** @type {Record<string, { c?: string, n?: string }> | null} */
let byEntityId = null;
let loadPromise = null;

const BUNDLE_PATH = 'data/aggregator-fields-default.json';

export function hasAggregatorFieldsLoaded() {
  return byEntityId !== null && Object.keys(byEntityId).length > 0;
}

/** Carica l’indice entity ID → codice/nome aggregatore (bundle in public/data). */
export async function ensureAggregatorFieldsBundle() {
  if (byEntityId) return byEntityId;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetch(`${baseUrl()}${BUNDLE_PATH}`);
      if (!res.ok) {
        byEntityId = {};
        return byEntityId;
      }
      const data = await res.json();
      byEntityId = data.byEntityId || {};
      return byEntityId;
    } catch {
      byEntityId = {};
      return byEntityId;
    }
  })();

  return loadPromise;
}

/** Applica codice/nome aggregatore dall’indice (se mancanti sull’entity). */
export function applyAggregatorFields(entity) {
  if (!entity?.entity_id || !byEntityId) return entity;
  const fields = byEntityId[entity.entity_id];
  if (!fields) return entity;

  const code = fields.c ?? fields.aggregator_code ?? null;
  const name = fields.n ?? fields.aggregator_name ?? null;

  return {
    ...entity,
    aggregator_code: entity.aggregator_code ?? code,
    aggregator_name: entity.aggregator_name ?? name,
  };
}

export function countDistinctAggregators(entities) {
  const codes = new Set();
  for (const e of entities) {
    if (e.aggregator_code) codes.add(e.aggregator_code);
  }
  return codes.size;
}
