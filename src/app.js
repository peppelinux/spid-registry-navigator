import {
  cacheEntryToListEntity,
  getCachedEntriesByFilter,
} from './api/metadata-cache.js';
import {
  getCachedPagination,
  hasFreshRegistryTotals,
  probeEntityPagination,
} from './api/pagination-probe.js';
import { applyAggregatorFields } from './api/aggregator-fields.js';
import {
  RegistryApiError,
  applyClientFilters,
  enrichEntity,
  fetchEntities,
  fetchEntity,
  listQueryParams,
} from './api/registry.js';
import { baseUrl } from './lib/base-url.js';
import { getCacheCoverage, XML_EXTENSION_KEYS } from './api/extension-authority.js';
import {
  buildExportFilename,
  downloadTextFile,
  entitiesToExportRows,
  rowsToCsv,
  rowsToJsonBundle,
} from './lib/list-export.js';
import { registryKindMany, registryKindRegistry } from './lib/registry-labels.js';
import { bindLabelsPanel } from './ui/labels-panel.js';
import {
  bindMetadataScanPanel,
  notifyDefaultCacheLoaded,
  renderScanPanelHtml,
} from './ui/metadata-scan-panel.js';
import {
  apidocLinkHtml,
  groupEntitiesByAggregator,
  renderAggregatorView,
  renderEntityDetail,
  renderEntityRow,
} from './ui/render.js';

const ENTITY_MODES = {
  IDP: { label: 'Identity Provider', entityType: 'IDP', federationType: null },
  SP: { label: 'SP (non aggregati)', entityType: 'SP', federationType: 'SP' },
  AG: { label: 'Aggregati', entityType: 'SP', federationType: 'AG' },
};

const state = {
  mode: 'SP',
  view: 'list',
  page: 1,
  pageSize: 50,
  search: '',
  filters: {
    professionale: false,
    firma: false,
    minori: false,
    eidas: false,
    aggregatorVariant: '',
  },
  aggregatorCode: '',
  items: [],
  total: 0,
  pages: 0,
  paginationExact: false,
  countingTotal: false,
  selectedId: null,
  selectedEntity: null,
  selectedAggregatorKey: null,
  loading: false,
  error: null,
};

let searchDebounce;
let paginationProbeAbort = null;
/** @type {{ renderStats?: () => void, updateRegistryTotalsTable?: () => void } | null} */
let scanPanelApi = null;

function cancelPaginationProbe() {
  paginationProbeAbort?.abort();
  paginationProbeAbort = null;
}

function queryParamsForMode() {
  const cfg = currentConfig();
  return listQueryParams({
    entityType: cfg.entityType,
    federationType: cfg.federationType,
    aggregatorCode: state.aggregatorCode,
  });
}

function formatCount(n) {
  return Number(n ?? 0).toLocaleString('it-IT');
}

function modeRegistryLabel() {
  return registryKindRegistry(state.mode);
}

/** Contesto paginazione registry: entity ID in pagina, pagina N/M, totale entity ID (se noto). */
function paginationContextParts() {
  const kind = modeRegistryLabel();
  const parts = [`${formatCount(state.items.length)} in questa pagina`];

  if (state.pages > 0) {
    parts.push(`pagina ${state.page} di ${formatCount(state.pages)}`);
  } else if (state.page > 0) {
    parts.push(`pagina ${state.page}`);
  }

  if (state.countingTotal) {
    parts.push(`totale ${kind}: in calcolo…`);
  } else if (state.paginationExact && state.total > 0) {
    parts.push(`${formatCount(state.total)} ${kind} nel registro`);
  }

  return parts;
}

/** Filtri che espandono l’elenco su tutta la cache XML (non la sola pagina API). */
const EXPANDED_LIST_FILTERS = XML_EXTENSION_KEYS;

const EXTENSION_FILTER_LABELS = {
  professionale: 'SPID professionale',
  firma: 'Firma con SPID',
  minori: 'SPID minori',
  eidas: 'eIDAS',
};

const EXTENSION_FILTER_HINTS = {
  professionale:
    'Metadata XML: IdP purpose PG/PF/LP/PX · SP/AG ACS «Pro» / attributi aziendali',
  firma: 'Metadata XML: AttributeConsumingService index 77',
  minori: 'Metadata XML: IdP SupportedAgeLimit · SP/AG spid:AgeLimit',
  eidas: 'Metadata XML: AttributeConsumingService index 99 o 100',
};

function activeExtensionFilters() {
  const keys = [];
  if (state.filters.professionale) keys.push('professionale');
  if (state.filters.firma) keys.push('firma');
  if (state.filters.minori) keys.push('minori');
  if (state.filters.eidas) keys.push('eidas');
  return keys;
}

function hasAnyListFilter() {
  return (
    activeExtensionFilters().length > 0 ||
    Boolean(state.filters.aggregatorVariant) ||
    Boolean(state.search.trim())
  );
}

function buildListSourceForFilters(filters) {
  const type = cacheEntityType();

  const cacheExt = [];
  if (filters.professionale) cacheExt.push('professionale');
  if (filters.firma) cacheExt.push('firma');
  if (filters.minori) cacheExt.push('minori');
  if (filters.eidas) cacheExt.push('eidas');

  if (cacheExt.length > 0) {
    const entries = getCachedEntriesByFilter({
      entityType: type,
      extensions: cacheExt,
    });
    const byId = new Map();
    for (const entry of entries) {
      byId.set(entry.entityId, enrichEntity(cacheEntryToListEntity(entry), type));
    }
    for (const item of state.items) {
      byId.set(item.entity_id, enrichEntity(item, type));
    }
    return [...byId.values()];
  }

  if (state.mode === 'AG' && state.view === 'aggregators') {
    const byId = new Map();
    for (const entry of getCachedEntriesByFilter({ entityType: type })) {
      byId.set(entry.entityId, enrichEntity(cacheEntryToListEntity(entry), type));
    }
    for (const item of state.items) {
      byId.set(item.entity_id, enrichEntity(item, type));
    }
    return [...byId.values()];
  }

  if (filters.search?.trim()) {
    const byId = new Map();
    for (const item of state.items) {
      byId.set(item.entity_id, enrichEntity(item, type));
    }
    const entries = getCachedEntriesByFilter({ entityType: type });
    for (const entry of entries) {
      if (!byId.has(entry.entityId)) {
        byId.set(entry.entityId, enrichEntity(cacheEntryToListEntity(entry), type));
      }
    }
    return [...byId.values()];
  }

  return enrichItems(state.items);
}

function countFilteredEntities(filters) {
  const source = buildListSourceForFilters(filters);
  return applyClientFilters(source, filters, cacheEntityType()).length;
}

function renderFilterCounts() {
  const box = el('filter-counts');
  if (!box) return;

  if (!hasAnyListFilter()) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const cfg = currentConfig();
  const filters = { search: state.search, ...state.filters };
  const visible = countFilteredEntities(filters);
  const lines = [];

  for (const key of activeExtensionFilters()) {
    const solo = {
      search: state.search,
      professionale: key === 'professionale',
      firma: key === 'firma',
      minori: key === 'minori',
      eidas: key === 'eidas',
      aggregatorVariant: state.filters.aggregatorVariant,
    };
    const inList = countFilteredEntities(solo);

    const inCache = getCachedEntriesByFilter({
      entityType: cacheEntityType(),
      extensions: [key],
    }).length;
    lines.push(
      `<li><span>${EXTENSION_FILTER_LABELS[key]}</span>: <strong>${formatCount(inList)}</strong> in elenco` +
        ` · <strong>${formatCount(inCache)}</strong> con estensione nel metadata XML (cache)` +
        `<br><span class="filter-counts__hint">${EXTENSION_FILTER_HINTS[key]}</span></li>`,
    );
  }

  if (state.filters.aggregatorVariant) {
    const onPage = applyClientFilters(
      enrichItems(state.items),
      {
        search: state.search,
        professionale: false,
        firma: false,
        minori: false,
        aggregatorVariant: state.filters.aggregatorVariant,
      },
      cacheEntityType(),
    ).length;
    lines.push(
      `<li><span>Variante ${state.filters.aggregatorVariant}</span>: <strong>${formatCount(onPage)}</strong> in pagina corrente</li>`,
    );
  }

  if (state.search.trim() && activeExtensionFilters().length === 0 && !state.filters.aggregatorVariant) {
    lines.push(
      `<li><span>Ricerca</span>: <strong>${formatCount(visible)}</strong> in elenco</li>`,
    );
  } else if (state.search.trim()) {
    lines.push(
      `<li><span>Con ricerca testuale</span>: <strong>${formatCount(visible)}</strong> in elenco</li>`,
    );
  }

  const pool = buildListSourceForFilters(filters).length;
  const combinedLabel =
    activeExtensionFilters().length > 1
      ? activeExtensionFilters().map((k) => EXTENSION_FILTER_LABELS[k]).join(' + ')
      : null;

  const onPage = applyClientFilters(
    enrichItems(state.items),
    filters,
    cacheEntityType(),
  ).length;

  const coverage = getCacheCoverage(cacheEntityType(), state.total || undefined);
  const coverageNote = coverage.complete
    ? `Cache XML: ${formatCount(coverage.cached)} entity ID analizzati`
    : `Cache XML incompleta (${formatCount(coverage.cached)}/${formatCount(coverage.expected || coverage.cached)}): eseguire «Costruisci cache (tutto il registro)» o npm run build:cache`;

  box.hidden = false;
  box.innerHTML = `
    <p class="filter-counts__head">
      <strong>${formatCount(visible)}</strong>
      ${registryKindMany(state.mode)} in elenco
      ${combinedLabel ? `<span class="muted">(${escapeHtml(combinedLabel)})</span>` : ''}
    </p>
    <p class="filter-counts__coverage muted${coverage.complete ? '' : ' filter-counts__coverage--warn'}">${escapeHtml(coverageNote)}</p>
    ${
      usesExpandedListView()
        ? `<p class="filter-counts__context muted">${escapeHtml(
            `${formatCount(onPage)} con filtro in questa pagina · ${formatCount(pool)} da pagina+cache`,
          )}</p>`
        : `<p class="filter-counts__context muted">${escapeHtml(
            `${formatCount(onPage)} con filtro in questa pagina`,
          )}</p>`
    }
    ${lines.length ? `<ul class="filter-counts__list">${lines.join('')}</ul>` : ''}
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function usesExpandedListView() {
  return (
    (state.mode === 'AG' && state.view === 'aggregators') ||
    activeExtensionFilters().some((k) => EXPANDED_LIST_FILTERS.includes(k)) ||
    Boolean(state.search.trim())
  );
}

function listItemsForDisplay() {
  return buildListSourceForFilters({ search: state.search, ...state.filters });
}

function updateStatusLine() {
  if (state.loading) {
    setStatus('Caricamento…');
    return;
  }

  const parts = [...paginationContextParts()];

  if (hasAnyListFilter()) {
    const filtered = applyClientFilters(
      listItemsForDisplay(),
      { search: state.search, ...state.filters },
      cacheEntityType(),
    );
    parts.push(`${formatCount(filtered.length)} in elenco`);
    const asymCount = filtered.filter((e) => e._asymmetries?.length).length;
    if (asymCount) parts.push(`${formatCount(asymCount)} con asimmetrie JSON/XML`);
  }

  setStatus(parts.join(' · '));
}

async function ensurePaginationTotals() {
  const params = queryParamsForMode();
  const cached = getCachedPagination(params);
  if (cached) {
    state.total = cached.entityCount;
    state.pages = cached.pages;
    state.paginationExact = true;
    updateStatusLine();
    scanPanelApi?.updateRegistryTotalsTable?.();
    render();
    return;
  }

  cancelPaginationProbe();
  const ac = new AbortController();
  paginationProbeAbort = ac;
  state.countingTotal = true;
  updateStatusLine();

  try {
    const { entityCount, pages } = await probeEntityPagination(
      params,
      state.pageSize,
      ac.signal,
    );
    if (ac.signal.aborted) return;
    state.total = entityCount;
    state.pages = pages;
    state.paginationExact = true;
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('Conteggio paginazione non riuscito:', err);
    }
  } finally {
    if (paginationProbeAbort === ac) paginationProbeAbort = null;
    state.countingTotal = false;
    render();
    updateStatusLine();
    scanPanelApi?.updateRegistryTotalsTable?.();
    scanPanelApi?.refreshRegistryTotals?.();
  }
}

function currentConfig() {
  return ENTITY_MODES[state.mode];
}

function cacheEntityType() {
  if (state.mode === 'AG') return 'AG';
  return currentConfig().entityType;
}

function enrichItems(items) {
  const type = cacheEntityType();
  return items.map((e) => enrichEntity(e, type));
}

function scanContext() {
  return {
    mode: state.mode,
    entityType: cacheEntityType(),
    page: state.page,
    pages: state.pages,
    total: state.total,
    selectedId: state.selectedId,
  };
}

/** Dopo scansione o validazione singola: riallinea lista/dettaglio alla cache XML. */
function applyCacheToUi({ entityId, entry } = {}) {
  const type = cacheEntityType();
  state.items = enrichItems(state.items);

  const id = entityId || state.selectedId;
  if (id) {
    if (state.selectedEntity?.entity_id === id) {
      state.selectedEntity = enrichEntity(state.selectedEntity, type);
    } else if (state.selectedId === id) {
      const base =
        state.items.find((e) => e.entity_id === id) ||
        (entry ? cacheEntryToListEntity(entry) : null);
      if (base) state.selectedEntity = enrichEntity(base, type);
    }
  }

  render();
  scanPanelApi?.renderStats?.();
  scanPanelApi?.renderLastScanHints?.();
  if (hasFreshRegistryTotals()) {
    scanPanelApi?.updateRegistryTotalsTable?.();
  } else {
    scanPanelApi?.refreshRegistryTotals?.();
  }
}

function el(id) {
  return document.getElementById(id);
}

function setStatus(message, isError = false) {
  const status = el('status-bar');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function loadPage(page = state.page) {
  const cfg = currentConfig();
  state.loading = true;
  state.error = null;
  state.page = page;
  render();

  try {
    const result = await fetchEntities({
      entityType: cfg.entityType,
      federationType: cfg.federationType,
      aggregatorCode: state.aggregatorCode || undefined,
      page,
      pageSize: state.pageSize,
    });

    state.items = enrichItems(result.items);
    state.page = result.page;
    state.paginationExact = result.paginationExact;

    if (result.paginationExact) {
      state.total = result.total;
      state.pages = result.pages ?? 1;
    } else {
      state.total = Math.max(state.total, result.total);
      if (!state.pages && result.pages) state.pages = result.pages;
      ensurePaginationTotals();
    }

    if (hasAnyListFilter()) {
      syncSelectionToFilteredList();
    } else {
      if (!state.selectedId && state.items.length) {
        state.selectedId = state.items[0].entity_id;
        state.selectedEntity = null;
      }
    }
  } catch (err) {
    state.error = err instanceof RegistryApiError ? err.message : String(err);
    state.items = [];
    setStatus(state.error, true);
  } finally {
    state.loading = false;
    render();
    updateStatusLine();
    if (state.selectedId && !state.selectedEntity) {
      loadDetail(state.selectedId);
    }
  }
}

async function loadDetail(entityId) {
  if (!entityId) {
    state.selectedEntity = null;
    renderDetail();
    return;
  }

  state.selectedId = entityId;
  renderList();

  try {
    const raw = await fetchEntity(entityId);
    state.selectedEntity = enrichEntity(raw, cacheEntityType());
  } catch {
    const fallback =
      filteredItems().find((e) => e.entity_id === entityId) ||
      state.items.find((e) => e.entity_id === entityId) ||
      null;
    state.selectedEntity = fallback
      ? enrichEntity(fallback, cacheEntityType())
      : null;
  }
  renderDetail();
}

function withAggregatorFields(items) {
  if (state.mode !== 'AG') return items;
  return items.map((e) => applyAggregatorFields(e));
}

function filteredItems() {
  let items = applyClientFilters(
    listItemsForDisplay(),
    { search: state.search, ...state.filters },
    cacheEntityType(),
  );
  items = withAggregatorFields(items);
  if (state.mode === 'AG' && state.aggregatorCode.trim()) {
    items = items.filter((e) => e.aggregator_code === state.aggregatorCode.trim());
  }
  return items;
}

/** Tutti i record esportabili: filtri/ricerca sull’intera cache, altrimenti tutta la categoria in cache. */
function collectExportItems() {
  const cfg = currentConfig();
  const type = cacheEntityType();
  const filters = { search: state.search, ...state.filters };

  if (hasAnyListFilter()) {
    return applyClientFilters(buildListSourceForFilters(filters), filters, cacheEntityType());
  }

  return getCachedEntriesByFilter({ entityType: type }).map((entry) =>
    enrichEntity(cacheEntryToListEntity(entry), type),
  );
}

function exportListResults(format) {
  const cfg = currentConfig();
  const items = collectExportItems();
  if (!items.length) {
    setStatus('Nessun record da esportare per i criteri correnti.', true);
    return;
  }

  const rows = entitiesToExportRows(items, cacheEntityType());
  const filtered = hasAnyListFilter();
  const meta = {
    mode: state.mode,
    filtered,
    search: state.search || null,
    filters: { ...state.filters },
    entityType: cfg.entityType,
  };

  const filename = buildExportFilename({
    mode: state.mode,
    filtered,
    count: rows.length,
    format,
  });

  if (format === 'json') {
    downloadTextFile(filename, rowsToJsonBundle(rows, meta), 'application/json;charset=utf-8');
  } else {
    downloadTextFile(filename, rowsToCsv(rows), 'text/csv;charset=utf-8');
  }

  const scope = filtered ? 'risultato filtri/ricerca' : `tutti i ${registryKindMany(state.mode)} in cache`;
  setStatus(`Esportati ${formatCount(rows.length)} record (${scope}) → ${filename}`);
}

function updateExportHint() {
  const hint = el('export-results-hint');
  const csvBtn = el('export-results-csv');
  const jsonBtn = el('export-results-json');
  if (!hint || !csvBtn || !jsonBtn) return;

  const count = collectExportItems().length;
  const disabled = count === 0;
  csvBtn.disabled = disabled;
  jsonBtn.disabled = disabled;

  if (hasAnyListFilter()) {
    hint.textContent = `${formatCount(count)} record nel risultato completo (non solo questa pagina).`;
  } else {
    hint.textContent = `${formatCount(count)} entity ID nella categoria corrente (cache XML). Usa ricerca/filtri per restringere.`;
  }
}

/** Dopo cambio filtri: selezione coerente con l’elenco filtrato (es. solo eIDAS in pagina). */
function syncSelectionToFilteredList() {
  const filtered = filteredItems();
  if (!filtered.length) {
    state.selectedId = null;
    state.selectedEntity = null;
    return;
  }
  if (!state.selectedId || !filtered.some((e) => e.entity_id === state.selectedId)) {
    state.selectedId = filtered[0].entity_id;
    state.selectedEntity = null;
  }
}

const AGGREGATOR_ROW_HEIGHT = 76;
const AGGREGATOR_VIRTUAL_THRESHOLD = 120;

function bindEntityRowClicks(container) {
  container.querySelectorAll('.entity-row').forEach((row) => {
    row.addEventListener('click', () => loadDetail(row.dataset.entityId));
  });
}

function mountAggregatorEntityList(listRoot, items, entityType) {
  const listEl = listRoot.querySelector('[data-aggregator-list]');
  if (!listEl) return;

  const prevScroll = listEl._aggregatorScrollHandler;
  if (prevScroll) listEl.removeEventListener('scroll', prevScroll);

  if (items.length <= AGGREGATOR_VIRTUAL_THRESHOLD) {
    listEl.classList.remove('aggregator-entities__list--virtual');
    listEl.innerHTML = items
      .map((e) => renderEntityRow(e, entityType, state.selectedId))
      .join('');
    bindEntityRowClicks(listEl);
    return;
  }

  listEl.classList.add('aggregator-entities__list--virtual');
  listEl.innerHTML = `
    <div class="aggregator-virtual-spacer" style="height:${items.length * AGGREGATOR_ROW_HEIGHT}px"></div>
    <div class="aggregator-virtual-inner"></div>
  `;
  const inner = listEl.querySelector('.aggregator-virtual-inner');

  const paint = () => {
    const scrollTop = listEl.scrollTop;
    const viewHeight = listEl.clientHeight || 480;
    const start = Math.max(0, Math.floor(scrollTop / AGGREGATOR_ROW_HEIGHT) - 10);
    const end = Math.min(
      items.length,
      Math.ceil((scrollTop + viewHeight) / AGGREGATOR_ROW_HEIGHT) + 10,
    );
    inner.style.transform = `translateY(${start * AGGREGATOR_ROW_HEIGHT}px)`;
    inner.innerHTML = items
      .slice(start, end)
      .map((e) => renderEntityRow(e, entityType, state.selectedId))
      .join('');
    bindEntityRowClicks(inner);
  };

  listEl._aggregatorScrollHandler = paint;
  listEl.addEventListener('scroll', paint, { passive: true });
  paint();
}

function renderAggregatorList() {
  const cfg = currentConfig();
  const list = el('entity-list');
  const groups = groupEntitiesByAggregator(filteredItems());

  if (!groups.length) {
    list.innerHTML = '<div class="list-placeholder">Nessun risultato per i filtri correnti.</div>';
    return;
  }

  if (
    !state.selectedAggregatorKey ||
    !groups.some((g) => g.key === state.selectedAggregatorKey)
  ) {
    state.selectedAggregatorKey = groups[0].key;
  }

  const selectedGroup = groups.find((g) => g.key === state.selectedAggregatorKey);
  if (selectedGroup) {
    const inGroup = selectedGroup.items.some((e) => e.entity_id === state.selectedId);
    if (!inGroup) {
      state.selectedId = selectedGroup.items[0]?.entity_id ?? null;
      state.selectedEntity = null;
    }
  }

  const displayType = cacheEntityType();
  list.innerHTML = renderAggregatorView({
    groups,
    selectedKey: state.selectedAggregatorKey,
    selectedId: state.selectedId,
    entityType: displayType,
  });

  mountAggregatorEntityList(list, selectedGroup.items, displayType);

  list.querySelectorAll('[data-aggregator-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedAggregatorKey = btn.dataset.aggregatorKey;
      const group = groups.find((g) => g.key === state.selectedAggregatorKey);
      if (group?.items.length) {
        state.selectedId = group.items[0].entity_id;
        state.selectedEntity = null;
      }
      renderAggregatorList();
      if (state.selectedId) loadDetail(state.selectedId);
    });
  });

  bindEntityRowClicks(list);
}

function aggregatorListHasSource() {
  return (
    getCachedEntriesByFilter({ entityType: cacheEntityType() }).length > 0 ||
    state.items.length > 0
  );
}

function renderList() {
  const cfg = currentConfig();
  const list = el('entity-list');

  if (state.mode === 'AG' && state.view === 'aggregators') {
    if (state.loading && !aggregatorListHasSource()) {
      list.innerHTML = '<div class="list-placeholder">Caricamento…</div>';
      return;
    }
    renderAggregatorList();
    return;
  }

  if (state.loading) {
    list.innerHTML = '<div class="list-placeholder">Caricamento…</div>';
    return;
  }

  const filtered = filteredItems();

  if (!filtered.length) {
    list.innerHTML = '<div class="list-placeholder">Nessun risultato per i filtri correnti.</div>';
    return;
  }

  list.innerHTML = filtered
    .map((entity) => renderEntityRow(entity, cacheEntityType(), state.selectedId))
    .join('');

  bindEntityRowClicks(list);
}

function renderDetail() {
  el('entity-detail').innerHTML = renderEntityDetail(state.selectedEntity, cacheEntityType());
}

function renderAggregatorPanel() {
  const panel = el('aggregator-panel');
  panel.hidden = true;
  panel.innerHTML = '';
}

function syncPaginationBars() {
  const hidden = state.view === 'aggregators' || usesExpandedListView();
  const labelText = paginationContextParts().join(' · ');
  const hasNextPage =
    state.pages > 0
      ? state.page < state.pages
      : state.items.length >= state.pageSize;

  document.querySelectorAll('[data-pagination-bar]').forEach((bar) => {
    bar.hidden = hidden;
    const prev = bar.querySelector('[data-page-prev]');
    const next = bar.querySelector('[data-page-next]');
    const label = bar.querySelector('[data-page-label]');
    if (prev) prev.disabled = state.page <= 1 || state.loading;
    if (next) next.disabled = state.loading || !hasNextPage;
    if (label) {
      label.textContent = labelText;
      label.removeAttribute('title');
    }
  });
}

function render() {
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === state.mode);
  });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.view === state.view);
  });

  el('filter-professionale').checked = state.filters.professionale;
  el('filter-firma').checked = state.filters.firma;
  el('filter-minori').checked = state.filters.minori;
  el('filter-eidas').checked = state.filters.eidas;
  el('filter-variant').value = state.filters.aggregatorVariant;
  el('search-input').value = state.search;
  el('aggregator-code').value = state.aggregatorCode;

  el('ag-controls').hidden = state.mode !== 'AG';
  syncPaginationBars();

  renderFilterCounts();
  renderList();
  renderDetail();
  renderAggregatorPanel();
  updateExportHint();
  updateStatusLine();
}

function bindEvents() {
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      state.page = 1;
      state.total = 0;
      state.pages = 0;
      state.paginationExact = false;
      cancelPaginationProbe();
      state.selectedId = null;
      state.selectedEntity = null;
      state.view = 'list';
      loadPage(1);
    });
  });

  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      if (state.view === 'aggregators') {
        state.selectedAggregatorKey = null;
      }
      syncSelectionToFilteredList();
      render();
      if (state.selectedId && !state.selectedEntity) {
        loadDetail(state.selectedId);
      }
    });
  });

  el('search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = e.target.value;
      syncSelectionToFilteredList();
      render();
    }, 250);
  });

  el('export-results-csv')?.addEventListener('click', () => exportListResults('csv'));
  el('export-results-json')?.addEventListener('click', () => exportListResults('json'));

  ['professionale', 'firma', 'minori', 'eidas'].forEach((key) => {
    el(`filter-${key}`).addEventListener('change', (e) => {
      state.filters[key] = e.target.checked;
      syncSelectionToFilteredList();
      render();
      if (state.selectedId && !state.selectedEntity) {
        loadDetail(state.selectedId);
      }
    });
  });

  el('filter-variant').addEventListener('change', (e) => {
    state.filters.aggregatorVariant = e.target.value;
    render();
  });

  el('aggregator-code').addEventListener('change', (e) => {
    state.aggregatorCode = e.target.value.trim();
    state.selectedAggregatorKey = null;
    state.page = 1;
    state.total = 0;
    state.pages = 0;
    state.paginationExact = false;
    cancelPaginationProbe();
    loadPage(1);
  });

  document.querySelectorAll('[data-page-prev]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.page > 1) loadPage(state.page - 1);
    });
  });

  document.querySelectorAll('[data-page-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.page < state.pages) loadPage(state.page + 1);
    });
  });

  el('refresh-btn').addEventListener('click', () => loadPage(state.page));

  bindLabelsPanel();
}

export async function mountApp(root, { cacheBootstrap } = {}) {
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div>
          <h1>SPID SAML2 Federation Search Engine</h1>
          <p class="subtitle">Navigazione registry · ${apidocLinkHtml()}</p>
        </div>
        <button type="button" class="btn" id="refresh-btn">Aggiorna</button>
      </header>

      <div class="app-body">
        <aside class="sidebar">
          <section class="panel">
            <h2>Categoria registry</h2>
            <div class="segmented">
              <button type="button" data-mode="IDP">IdP</button>
              <button type="button" data-mode="SP">SP</button>
              <button type="button" data-mode="AG">Aggregati</button>
            </div>
          </section>

          <section class="panel" id="ag-controls" hidden>
            <h2>Aggregatori</h2>
            <div class="segmented segmented--small">
              <button type="button" data-view="list">Lista</button>
              <button type="button" data-view="aggregators">Per aggregatore</button>
            </div>
            <label class="field">
              <span>Codice aggregatore (IPA/PIVA)</span>
              <input type="text" id="aggregator-code" placeholder="es. IT03743021218" />
            </label>
            <label class="field">
              <span>Variante</span>
              <select id="filter-variant">
                <option value="">Tutte (full + light)</option>
                <option value="full">Solo full</option>
                <option value="light">Solo light</option>
              </select>
            </label>
          </section>

          <section class="panel">
            <h2>Ricerca ed export</h2>
            <div class="search-context" id="search-context">
              <input
                type="search"
                id="search-input"
                class="search-input"
                placeholder="Entity ID, nome, codice…"
              />
              <p class="hint" id="export-results-hint">Esporta l’elenco completo (tutti i match, non solo la pagina corrente).</p>
              <div class="export-actions">
                <button type="button" class="btn btn-secondary btn--block" id="export-results-csv">
                  Esporta CSV
                </button>
                <button type="button" class="btn btn-secondary btn--block" id="export-results-json">
                  Esporta JSON
                </button>
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>Estensioni</h2>
            <label class="check"><input type="checkbox" id="filter-professionale" /> SPID professionale</label>
            <label class="check"><input type="checkbox" id="filter-firma" /> Firma con SPID (ACS #77)</label>
            <label class="check"><input type="checkbox" id="filter-minori" /> SPID minori</label>
            <label class="check"><input type="checkbox" id="filter-eidas" /> eIDAS</label>
            <div id="filter-counts" class="filter-counts" hidden></div>
            <p class="hint">Filtri basati sul <strong>metadata XML completo</strong> in cache (tutti gli entity ID del registro). Non usa euristiche JSON sulla pagina corrente. <a href="#" id="labels-help">Guida</a></p>
          </section>

          ${renderScanPanelHtml()}
        </aside>

        <main class="main">
          <div id="status-bar" class="status-bar"></div>
          <div id="aggregator-panel" class="aggregator-panel" hidden></div>
          <div class="main-columns">
            <div class="list-panel">
              <nav
                class="pagination pagination--top"
                id="pagination-top"
                data-pagination-bar
                aria-label="Paginazione elenco (in alto)"
              >
                <button type="button" class="btn btn-secondary" data-page-prev>← Precedente</button>
                <p class="pagination__summary" data-page-label>50 in questa pagina · pagina 1</p>
                <button type="button" class="btn btn-secondary" data-page-next>Successiva →</button>
              </nav>
              <div class="entity-list-scroll">
                <div id="entity-list" class="entity-list"></div>
              </div>
              <nav
                class="pagination pagination--bottom"
                id="pagination"
                data-pagination-bar
                aria-label="Paginazione elenco (in basso)"
              >
                <button type="button" class="btn btn-secondary" data-page-prev>← Precedente</button>
                <p class="pagination__summary" data-page-label>50 in questa pagina · pagina 1</p>
                <button type="button" class="btn btn-secondary" data-page-next>Successiva →</button>
              </nav>
            </div>
            <div id="entity-detail" class="detail-panel"></div>
          </div>
        </main>
      </div>

      <div id="labels-panel" class="labels-panel" hidden>
        <div id="labels-panel-backdrop" class="labels-panel__backdrop"></div>
        <div class="labels-panel__dialog" role="dialog" aria-labelledby="labels-panel-title">
          <header class="labels-panel__header">
            <h2 id="labels-panel-title">Guida alle etichette</h2>
            <div class="labels-panel__actions">
              <a class="btn btn-secondary" href="${baseUrl('labels.html')}" target="_blank" rel="noopener">Nuova scheda</a>
              <button type="button" class="btn btn-secondary" id="labels-panel-close">Chiudi</button>
            </div>
          </header>
          <div id="labels-panel-body" class="labels-panel__body"></div>
        </div>
      </div>
    </div>
  `;

  bindEvents();

  scanPanelApi = bindMetadataScanPanel(scanContext, applyCacheToUi);
  scanPanelApi.renderLastScanHints();

  if (cacheBootstrap?.loaded) {
    notifyDefaultCacheLoaded(cacheBootstrap.total);
  } else if (
    cacheBootstrap?.reason === 'bundle-missing' ||
    cacheBootstrap?.reason === 'bundle-empty' ||
    cacheBootstrap?.reason === 'import-failed'
  ) {
    setStatus(
      'Cache vuota — in «Aggiorna cache» usa «Tutto il registro» oppure genera la cache con npm run build:cache.',
    );
  }

  await loadPage(1);
}
