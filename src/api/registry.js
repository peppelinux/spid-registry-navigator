import { matchesExtensionFromXmlCache } from './extension-authority.js';
import { matchesSearchDual } from './entity-consistency.js';
import {
  hasFirmaExtension as hasFirmaHeuristic,
  hasMinoriHeuristic,
  hasProfessionalExtension as hasProfessionalHeuristic,
  matchesSearchJson,
} from './extension-heuristics.js';
import { cacheEntryHasExtension } from './extension-xml.js';
import {
  enrichEntity,
  getCachedEntry,
  isStale,
} from './metadata-cache.js';

/** Filtri estensione: solo metadata XML in cache (risposte complete, non euristiche JSON). */
function matchesExtensionFilter(entity, entityType, ext) {
  return matchesExtensionFromXmlCache(entity, entityType, ext);
}

/** Il registry espone ACAO * — chiamata diretta senza proxy. */
const API_BASE = 'https://registry.spid.gov.it';

export class RegistryApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'RegistryApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const title = body?.title || response.statusText;
    throw new RegistryApiError(title, response.status, body);
  }

  // Header di paginazione: leggibili solo se il registry li espone in Access-Control-Expose-Headers.
  const total = Number(response.headers.get('tot-metadata') || 0);
  const pages = Number(response.headers.get('tot-pages') || 0);
  const page = Number(response.headers.get('current-page') || 0);

  return {
    data: body,
    headers: { total, pages, page },
    paginationFromHeaders: total > 0 || pages > 0,
  };
}

/** Stima paginazione quando gli header HTTP non sono leggibili dal browser (CORS). */
export function inferPaginationFromPage({ items, page, pageSize, headerTotal, headerPages }) {
  if (headerTotal > 0 && headerPages > 0) {
    return { total: headerTotal, pages: headerPages, exact: true };
  }

  const count = items.length;
  if (count < pageSize) {
    const total = (page - 1) * pageSize + count;
    return { total, pages: page, exact: true };
  }

  return {
    total: page * pageSize,
    pages: null,
    exact: false,
  };
}

export function encodeEntityId(entityId) {
  return encodeURIComponent(entityId);
}

export async function fetchEntities({
  entityType,
  federationType,
  aggregatorCode,
  page = 1,
  pageSize = 50,
  code,
}) {
  const params = {
    entity_type: entityType,
    output: 'json',
    page: String(page),
    numMetadata: String(pageSize),
  };

  if (federationType) params.federation_type = federationType;
  if (aggregatorCode) params.aggregator_code = aggregatorCode;
  if (code) params.code = code;

  const { data, headers, paginationFromHeaders } = await request('/entities', params);
  const items = Array.isArray(data) ? data : [];
  const pageNum = headers.page || page;
  const inferred = inferPaginationFromPage({
    items,
    page: pageNum,
    pageSize,
    headerTotal: headers.total,
    headerPages: headers.pages,
  });

  return {
    items,
    total: inferred.total,
    pages: inferred.pages,
    page: pageNum,
    paginationExact: inferred.exact,
    paginationFromHeaders,
  };
}

export function listQueryParams({ entityType, federationType, aggregatorCode }) {
  return { entityType, federationType: federationType ?? null, aggregatorCode: aggregatorCode ?? null };
}

export async function fetchEntity(entityId) {
  const { data } = await request(`/entities/${encodeEntityId(entityId)}`, {
    output: 'json',
  });
  return data;
}

export function entityDetailUrl(entityId) {
  return `${API_BASE}/entities/${encodeEntityId(entityId)}?output=json`;
}

export function entityXmlUrl(entityId) {
  return `${API_BASE}/entities/${encodeEntityId(entityId)}`;
}

export function apidocUrl() {
  return 'https://registry.spid.gov.it/apidoc';
}

/** Aggregatore full/light da entity_id (pub-ag-full, pub-ag-lite, …). */
export function getAggregatorVariant(entity) {
  const id = (entity?.entity_id || '').toLowerCase();
  if (id.includes('pub-ag-full') || id.includes('pri-ag-full')) return 'full';
  if (id.includes('pub-ag-lite') || id.includes('pri-ag-lite') || id.includes('pub-ag-light')) {
    return 'light';
  }
  return null;
}

export function isAggregatorEntity(entity) {
  return entity?.federation_type === 'AG' || getAggregatorVariant(entity) !== null;
}

export { enrichEntity };

/** Estensioni SPID: unione JSON API + flag XML in cache (se presente). */
export function hasMinoriExtension(entity, entityType) {
  return matchesExtensionFilter(entity, entityType, 'minori');
}

export function hasFirmaExtension(entity, entityType = 'SP') {
  return matchesExtensionFilter(entity, entityType, 'firma');
}

export function hasProfessionalExtension(entity, entityType) {
  return matchesExtensionFilter(entity, entityType, 'professionale');
}

export function hasEidasExtension(entity, entityType) {
  return matchesExtensionFilter(entity, entityType, 'eidas');
}

export function getMinoriBadgeKind(entity, entityType) {
  const cached = getCachedEntry(entity?.entity_id);
  if (cached) {
    return {
      show: Boolean(cached.flags?.minoriXml),
      kind: cached.flags?.minoriXml ? 'xml' : 'xml-none',
      stale: isStale(cached),
    };
  }
  if (entityType === 'IDP' && getIdpSupportedAgeLimitSet().has(entity.entity_id)) {
    return { show: true, kind: 'xml-index', stale: false };
  }
  const heuristic = hasMinoriHeuristic(entity, entityType);
  return { show: heuristic, kind: heuristic ? 'heuristic' : null, stale: false };
}

export function matchesSearch(entity, query) {
  return matchesSearchJson(entity, query);
}

export function applyClientFilters(entities, filters, entityType) {
  return entities.filter((entity) => {
    if (filters.aggregatorVariant) {
      const variant = getAggregatorVariant(entity);
      if (variant !== filters.aggregatorVariant) return false;
    }

    if (filters.professionale && !matchesExtensionFilter(entity, entityType, 'professionale')) {
      return false;
    }
    if (filters.firma && !matchesExtensionFilter(entity, entityType, 'firma')) {
      return false;
    }
    if (filters.minori && !matchesExtensionFilter(entity, entityType, 'minori')) {
      return false;
    }
    if (filters.eidas && !matchesExtensionFilter(entity, entityType, 'eidas')) {
      return false;
    }

    if (!matchesSearchDual(entity, filters.search, entityType)) return false;
    return true;
  });
}
