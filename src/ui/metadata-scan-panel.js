import {
  exportCacheBundle,
  getCacheStats,
  getLastScan,
  importBundledDefaultCache,
  importCacheBundle,
  subscribeCache,
} from '../api/metadata-cache.js';
import {
  formatCount,
  labelEntityIds,
  labelEntityIdsAnalyzedThisScan,
  labelEntityIdsInCache,
  labelEntityIdsInRegistry,
  labelEntityIdsOnApiBundle,
  labelExportedCache,
  labelImportedCache,
  registryKindMany,
  registryKindOne,
  registryKindRegistry,
} from '../lib/registry-labels.js';
import {
  ensureAllRegistryTotals,
  getRegistryTotalsSnapshot,
  hasFreshRegistryTotals,
} from '../api/pagination-probe.js';
import {
  FULL_REGISTRY_SCAN_KEY,
  abortScan,
  createScanSignal,
  formatScanAge,
  isScanRunning,
  releaseScan,
  runMetadataScan,
} from '../api/metadata-scan.js';
import { validateSingleEntity } from '../api/metadata-validate.js';

const MAX_LOG_LINES = 200;

let scanState = {
  running: false,
  message: '',
  entitiesProcessed: 0,
  registryEntityTotal: 0,
  cacheTotal: 0,
  listMode: 'SP',
  registryPage: 0,
  registryPagesTotal: 0,
  entityId: null,
  withExtensions: 0,
  percent: 0,
  indeterminate: false,
};

let onScanComplete = null;
let panelReady = false;

function el(id) {
  return document.getElementById(id);
}

function showPanel() {
  const panel = el('xml-scan-progress');
  if (!panel) return;
  panel.hidden = false;
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function appendLog(message, kind = 'info') {
  const logEl = el('scan-log');
  if (!logEl) return;

  const time = new Date().toLocaleTimeString('it-IT', { hour12: false });
  const line = document.createElement('div');
  line.className = `scan-log__line scan-log__line--${kind}`;
  line.textContent = `${time} — ${message}`;
  logEl.appendChild(line);

  while (logEl.childElementCount > MAX_LOG_LINES) {
    logEl.firstElementChild?.remove();
  }

  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  const logEl = el('scan-log');
  if (logEl) logEl.innerHTML = '';
}

function updateProgressUi() {
  if (!panelReady) return;

  showPanel();

  const statusEl = el('scan-status-text');
  const metaEl = el('scan-meta-text');
  const entityEl = el('scan-entity-text');
  const fillEl = el('scan-progress-fill');
  const barEl = el('scan-progress-bar');
  const abortBtn = el('scan-abort-btn');

  if (statusEl) statusEl.textContent = scanState.message || 'Validazione metadata XML…';

  const percent = scanState.indeterminate
    ? 0
    : scanState.percent ??
      (scanState.registryEntityTotal > 0
        ? Math.min(
            100,
            Math.round((scanState.entitiesProcessed / scanState.registryEntityTotal) * 100),
          )
        : 0);

  if (fillEl) {
    fillEl.style.width = scanState.indeterminate ? '100%' : `${percent}%`;
    fillEl.classList.toggle('progress-bar__fill--indeterminate', scanState.indeterminate);
  }
  if (barEl) {
    barEl.setAttribute('aria-valuenow', scanState.indeterminate ? 0 : percent);
    barEl.classList.toggle('progress-bar--indeterminate', scanState.indeterminate);
  }

  if (metaEl) {
    const parts = [];
    const kind = registryKindRegistry(scanState.listMode || 'SP');
    if (scanState.running || scanState.entitiesProcessed > 0) {
      parts.push(labelEntityIdsAnalyzedThisScan(scanState.entitiesProcessed));
      if (scanState.registryEntityTotal > 0) {
        parts.push(`su ${labelEntityIdsInRegistry(kind, scanState.registryEntityTotal)}`);
      } else if (scanState.running) {
        parts.push('totale entity ID nel registro: in calcolo…');
      }
    }
    if (scanState.registryLayer) {
      parts.push(scanState.registryLayer);
    }
    if (scanState.registryPage) {
      parts.push(
        `pagina API ${scanState.registryPage}/${scanState.registryPagesTotal || '…'}`,
      );
    }
    if (scanState.cacheTotal > 0) {
      parts.push(labelEntityIdsInCache(scanState.cacheTotal));
    }
    if (scanState.withExtensions) {
      parts.push(`${fmt(scanState.withExtensions)} con estensioni SPID`);
    }
    metaEl.textContent = parts.join(' · ');
  }

  if (entityEl) {
    if (scanState.entityId) {
      entityEl.textContent = scanState.entityId;
      entityEl.title = scanState.entityId;
      entityEl.hidden = false;
    } else {
      entityEl.hidden = true;
    }
  }

  if (abortBtn) abortBtn.hidden = !scanState.running;
}

function setButtonsDisabled(disabled) {
  document.querySelectorAll('[data-scan]').forEach((btn) => {
    btn.disabled = disabled;
  });
  const validateBtn = el('validate-selected-btn');
  if (validateBtn) validateBtn.disabled = disabled;
}

function resetScanState(overrides = {}) {
  scanState = {
    running: false,
    message: '',
    entitiesProcessed: 0,
    registryEntityTotal: 0,
    cacheTotal: 0,
    listMode: 'SP',
    registryPage: 0,
    registryPagesTotal: 0,
    registryLayer: null,
    entityId: null,
    withExtensions: 0,
    percent: 0,
    indeterminate: false,
    ...overrides,
  };
}

function handleProgress(event) {
  switch (event.type) {
    case 'start':
      scanState.running = true;
      scanState.message = `Avvio: ${event.scopeLabel}`;
      scanState.entitiesProcessed = 0;
      scanState.listMode = event.listMode || 'SP';
      scanState.registryEntityTotal =
        event.registryEntityTotal > 0 ? event.registryEntityTotal : 0;
      scanState.registryPagesTotal = event.registryPagesTotal || 0;
      scanState.registryPage = 0;
      scanState.entityId = null;
      scanState.withExtensions = 0;
      scanState.indeterminate = !scanState.registryEntityTotal;
      appendLog(scanState.message);
      break;

    case 'step':
      scanState.message = event.message;
      if (event.percent != null) scanState.percent = event.percent;
      scanState.indeterminate = Boolean(event.indeterminate);
      appendLog(event.message);
      break;

    case 'page':
      scanState.registryPage = event.registryPage;
      scanState.registryPagesTotal = event.registryPagesTotal;
      scanState.registryLayer = event.registryLayer ?? scanState.registryLayer;
      scanState.message = event.registryLayer
        ? `${event.registryLayer}: pagina ${event.registryPage} / ${event.registryPagesTotal}`
        : `Pagina API ${event.registryPage} / ${event.registryPagesTotal}`;
      appendLog(
        `Download pagina API ${event.registryPage} di ${event.registryPagesTotal}`,
      );
      break;

    case 'pageDone': {
      scanState.cacheTotal = event.cacheTotal;
      const kindOne = registryKindOne(event.listMode || scanState.listMode);
      appendLog(
        `Pagina API ${event.registryPage}: ${labelEntityIdsOnApiBundle(event.entitiesOnPage)} · ` +
          `${labelEntityIds(event.cacheForType)} ${kindOne} in cache · ` +
          `${labelEntityIdsInCache(event.cacheTotal)}`,
        event.entitiesOnPage > 0 ? 'ok' : 'warn',
      );
      break;
    }

    case 'entity':
      scanState.entitiesProcessed = event.entitiesProcessed;
      if (event.registryEntityTotal > 0) {
        scanState.registryEntityTotal = event.registryEntityTotal;
      }
      scanState.entityId = event.entityId;
      scanState.indeterminate = false;
      if (event.hasExtensions) scanState.withExtensions += 1;
      if (
        event.entitiesProcessed === 1 ||
        event.entitiesProcessed % 25 === 0 ||
        (scanState.registryEntityTotal > 0 &&
          event.entitiesProcessed === scanState.registryEntityTotal)
      ) {
        const tag = event.hasExtensions ? 'ok' : 'info';
        const denom =
          scanState.registryEntityTotal > 0
            ? fmt(scanState.registryEntityTotal)
            : '?';
        appendLog(
          `[${fmt(event.entitiesProcessed)}/${denom}] ${event.entityId}${event.hasExtensions ? ' ✓ estensioni' : ''}`,
          tag,
        );
      }
      break;

    case 'error':
      scanState.message = event.message;
      appendLog(event.message, 'error');
      break;

    case 'done': {
      scanState.running = false;
      scanState.indeterminate = false;
      scanState.percent = 100;
      scanState.entitiesProcessed = event.processed;
      if (event.registryEntityTotal > 0) {
        scanState.registryEntityTotal = event.registryEntityTotal;
      }
      scanState.cacheTotal = event.cacheTotal ?? scanState.cacheTotal;
      const kind = registryKindMany(event.listMode || scanState.listMode || 'SP');
      scanState.message = event.aborted
        ? 'Scansione interrotta'
        : `Scansione: ${labelEntityIdsAnalyzedThisScan(event.processed)} (${kind}) · ` +
          `${labelEntityIds(event.cacheForType ?? 0)} ${registryKindOne(event.listMode)} in cache · ` +
          `${labelEntityIdsInCache(event.cacheTotal ?? 0)}`;
      appendLog(scanState.message, event.aborted ? 'warn' : 'ok');
      setButtonsDisabled(false);
      renderStats();
      onScanComplete?.(event);
      break;
    }

    default:
      break;
  }

  updateProgressUi();
}

function bindAbortButton() {
  const abortBtn = el('scan-abort-btn');
  if (!abortBtn || abortBtn.dataset.bound) return;
  abortBtn.dataset.bound = '1';
  abortBtn.addEventListener('click', () => {
    appendLog('Interruzione richiesta…', 'warn');
    abortScan();
    scanState.running = false;
    scanState.indeterminate = false;
    scanState.message = 'Interrotto';
    setButtonsDisabled(false);
    updateProgressUi();
    releaseScan();
  });
}

function initProgressPanel() {
  panelReady = true;
  bindAbortButton();
}

function fmt(n) {
  return formatCount(n);
}

let registryTotalsPromise = null;

function updateRegistryTotalsTable() {
  const body = el('registry-totals-body');
  const hint = el('registry-totals-hint');
  if (!body) return;

  body.innerHTML = registryTotalsRowsHtml();
  const snap = getRegistryTotalsSnapshot();
  const known = snap.filter((r) => r.entityCount != null).length;
  if (!hint) return;

  if (known === snap.length) {
    hint.hidden = true;
    return;
  }
  hint.hidden = false;
  hint.textContent =
    registryTotalsPromise != null
      ? `Conteggio registro in corso (${known}/${snap.length})…`
      : `Apri un tab IdP/SP/Aggregati per avviare il conteggio, oppure attendi (${known}/${snap.length}).`;
}

function refreshRegistryTotals({ force = false } = {}) {
  if (registryTotalsPromise) return registryTotalsPromise;

  const snap = getRegistryTotalsSnapshot();
  if (!force && hasFreshRegistryTotals()) {
    renderCacheStatsSection();
    return Promise.resolve();
  }

  registryTotalsPromise = ensureAllRegistryTotals(undefined, (done, total) => {
    updateRegistryTotalsTable();
    const hint = el('registry-totals-hint');
    if (hint && done < total) {
      hint.hidden = false;
      hint.textContent = `Conteggio registro in corso (${done}/${total})…`;
    }
  })
    .then(() => {
      renderCacheStatsSection();
    })
    .catch((err) => {
      if (err?.name === 'AbortError') return;
      const hint = el('registry-totals-hint');
      if (hint) {
        hint.textContent = `Conteggio registro non riuscito: ${err.message || err}`;
        hint.hidden = false;
      }
    })
    .finally(() => {
      registryTotalsPromise = null;
    });

  return registryTotalsPromise;
}

function cacheStatsIntroHtml() {
  const snap = getRegistryTotalsSnapshot();
  const allSp = snap.find((r) => r.label.startsWith('Tutti gli SP'));
  const regPart =
    allSp?.entityCount != null
      ? `${fmt(allSp.entityCount)} entity ID SP (non aggregati + aggregati)`
      : 'conteggio entity ID in corso (tabella sotto)';

  return `
    <strong>Nel registro</strong> = entity ID distinti pubblicati su registry.spid.gov.it
    (${regPart}).
    <strong>In cache</strong> = metadata XML scaricato e analizzato (flag filtri minori / firma / professionale / eIDAS).
    I filtri in sidebar usano <strong>solo</strong> questa cache, non il JSON API. Un <code>EntityDescriptor</code> = un entity ID; usa
    <strong>Aggiorna cache → Tutto il registro</strong> per coprire IdP, SP e aggregati.
  `;
}

function registryTotalsRowsHtml() {
  return getRegistryTotalsSnapshot()
    .map(({ label, entityCount, pages, note }) => {
      const totalCell =
        entityCount != null
          ? `<strong>${fmt(entityCount)}</strong> entity ID`
          : '<span class="muted">in calcolo…</span>';
      const pagesCell = pages != null ? `${fmt(pages)} pag.` : '—';
      const noteCell = note ? `<span class="muted">${note}</span>` : '';
      return `<tr>
        <td>${label}${noteCell ? `<br>${noteCell}` : ''}</td>
        <td>${totalCell}</td>
        <td>${pagesCell}</td>
      </tr>`;
    })
    .join('');
}

function renderCacheStatsSection() {
  const box = el('xml-cache-stats');
  if (!box) return;

  box.innerHTML = `
    <p class="cache-stats-intro muted">${cacheStatsIntroHtml()}</p>
    <h3 class="cache-stats-heading">Nel registro SPID</h3>
    <table class="cache-stats-table" aria-label="Totali nel registro">
      <thead>
        <tr><th>Elenco</th><th>Entity ID</th><th>Pagine API</th></tr>
      </thead>
      <tbody id="registry-totals-body"></tbody>
    </table>
    <p class="cache-stats-foot muted" id="registry-totals-hint">Conteggio entity ID in background se i totali non sono ancora noti.</p>
  `;

  updateRegistryTotalsTable();
}

function renderStats() {
  renderCacheStatsSection();
}

function setCacheIoStatus(message, kind = 'info') {
  const status = el('cache-io-status');
  if (!status) return;
  status.textContent = message;
  status.className = `cache-io-status cache-io-status--${kind}`;
  status.hidden = !message;
}

function downloadCacheFile() {
  const bundle = exportCacheBundle();
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spid-registry-metadata-cache-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setCacheIoStatus(labelExportedCache(Object.keys(bundle.entries).length), 'ok');
}

async function handleImportFile(file, mode) {
  const text = await file.text();
  const data = JSON.parse(text);
  const result = importCacheBundle(data, { mode });
  setCacheIoStatus(
    labelImportedCache({
      added: result.added,
      updated: result.updated,
      total: result.total,
    }),
    'ok',
  );
  onScanComplete?.();
}

function bindCacheIo() {
  el('cache-export-btn')?.addEventListener('click', () => {
    try {
      downloadCacheFile();
    } catch (err) {
      setCacheIoStatus(`Export fallito: ${err.message}`, 'error');
    }
  });

  const fileInput = el('cache-import-input');
  el('cache-import-merge-btn')?.addEventListener('click', () => {
    if (!fileInput) return;
    fileInput.dataset.mode = 'merge';
    fileInput.click();
  });
  el('cache-import-replace-btn')?.addEventListener('click', () => {
    if (!fileInput) return;
    if (!window.confirm('Sostituire tutta la cache locale con il file importato?')) return;
    fileInput.dataset.mode = 'replace';
    fileInput.click();
  });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const mode = fileInput.dataset.mode === 'replace' ? 'replace' : 'merge';
    try {
      await handleImportFile(file, mode);
    } catch (err) {
      setCacheIoStatus(`Import fallito: ${err.message}`, 'error');
    }
  });

  el('cache-default-btn')?.addEventListener('click', async () => {
    if (
      getCacheStats().total > 0 &&
      !window.confirm('Sostituire la cache locale con quella predefinita del progetto?')
    ) {
      return;
    }
    try {
      const result = await importBundledDefaultCache();
      setCacheIoStatus(`Cache predefinita: ${labelEntityIds(result.total)} in cache`, 'ok');
      onScanComplete?.();
    } catch (err) {
      setCacheIoStatus(err.message, 'error');
    }
  });
}

/** Chiamato all’avvio se è stata caricata la cache predefinita. */
export function notifyDefaultCacheLoaded(total) {
  setCacheIoStatus(`Cache predefinita caricata (${labelEntityIds(total)} in cache locale)`, 'ok');
}

async function startScan(scope, getContext) {
  if (isScanRunning()) return;

  if (scope === 'ALL') {
    const ok = window.confirm(
      'Scaricare i metadata XML di tutti gli entity ID del registro SPID?\n\n' +
        '• IdP\n' +
        '• SP non aggregati\n' +
        '• Aggregati\n\n' +
        'Un entity ID per ogni EntityDescriptor nei metadata. Centinaia di pagine API: operazione lunga.',
    );
    if (!ok) return;
  }

  const ctx = getContext();
  clearLog();
  resetScanState({
    running: true,
    message: 'Avvio…',
    listMode: ctx.mode,
    registryEntityTotal: 0,
    registryPagesTotal: ctx.pages || 1,
    indeterminate: true,
  });
  setButtonsDisabled(true);
  updateProgressUi();
  appendLog(`Scansione: ${scope}`);

  createScanSignal();

  try {
    await runMetadataScan({
      scope,
      mode: ctx.mode,
      currentPage: ctx.page,
      totalPages: ctx.pages,
      onProgress: handleProgress,
    });
  } finally {
    if (isScanRunning()) releaseScan();
    setButtonsDisabled(false);
    updateProgressUi();
  }
}

function lastScanHint(scopeKey) {
  const when = formatScanAge(scopeKey);
  if (!when) return '';
  return ` <span class="muted">(${when})</span>`;
}

export function bindMetadataScanPanel(getContext, onComplete) {
  onScanComplete = onComplete;
  initProgressPanel();
  bindCacheIo();

  subscribeCache(() => {
    if (!scanState.running) {
      onComplete?.();
    }
    if (!scanState.running && !hasFreshRegistryTotals()) {
      refreshRegistryTotals();
    } else if (!scanState.running) {
      renderCacheStatsSection();
    }
  });

  renderStats();
  refreshRegistryTotals();

  document.querySelectorAll('[data-scan]').forEach((btn) => {
    btn.addEventListener('click', () => startScan(btn.dataset.scan, getContext));
  });

  el('validate-selected-btn')?.addEventListener('click', async () => {
    const ctx = getContext();
    if (!ctx.selectedId) {
      appendLog('Nessun record selezionato in lista', 'warn');
      showPanel();
      updateProgressUi();
      return;
    }

    if (isScanRunning()) return;

    clearLog();
    resetScanState({
      running: true,
      message: 'Aggiornamento in corso…',
      registryEntityTotal: 1,
      entitiesProcessed: 0,
      entityId: ctx.selectedId,
      indeterminate: true,
    });
    setButtonsDisabled(true);
    appendLog(`Download XML fresco dal registry: ${ctx.selectedId}`);
    updateProgressUi();

    const signal = createScanSignal();

    try {
      const result = await validateSingleEntity(
        ctx.selectedId,
        ctx.entityType,
        handleProgress,
        signal,
        { forceRefresh: true },
      );
      scanState.running = false;
      scanState.indeterminate = false;
      scanState.percent = 100;
      scanState.entitiesProcessed = 1;
      scanState.message = 'Completato — cache aggiornata per il record selezionato';
      scanState.withExtensions = result.flags &&
        (result.flags.minoriXml || result.flags.firmaXml || result.flags.professionaleXml)
        ? 1
        : 0;
      appendLog(scanState.message, 'ok');
      appendLog(`Cache aggiornata: ${ctx.selectedId}`, 'ok');
      scanState.cacheTotal = getCacheStats().total;
      onComplete?.({
        entityId: ctx.selectedId,
        entry: result,
        listMode: ctx.entityType,
        source: 'validate',
      });
    } catch (err) {
      scanState.running = false;
      scanState.indeterminate = false;
      if (err.name === 'AbortError') {
        scanState.message = 'Aggiornamento interrotto';
        appendLog(scanState.message, 'warn');
      } else {
        scanState.message = `Errore: ${err.message}`;
        appendLog(scanState.message, 'error');
      }
    } finally {
      releaseScan();
      setButtonsDisabled(false);
      renderStats();
      updateProgressUi();
    }
  });

  function renderLastScanHints() {
    const pageHint = el('scan-hint-page');
    if (pageHint) {
      pageHint.innerHTML = lastScanHint(`page-${getContext().mode}-${getContext().page}`);
    }
    const spHint = el('scan-hint-sp');
    if (spHint) spHint.innerHTML = lastScanHint('scan-SP');
    const agHint = el('scan-hint-ag');
    if (agHint) agHint.innerHTML = lastScanHint('scan-AG');
    const idpHint = el('scan-hint-idp');
    if (idpHint) idpHint.innerHTML = lastScanHint('scan-IDP');
    const fullHint = el('scan-hint-full');
    if (fullHint) fullHint.innerHTML = lastScanHint(FULL_REGISTRY_SCAN_KEY);
  }

  return {
    startFullRegistryBuild: () => startScan('ALL', getContext),
    renderStats,
    renderLastScanHints,
    refreshRegistryTotals,
    updateRegistryTotalsTable,
  };
}

export function renderScanPanelHtml() {
  return `
    <section class="panel panel--scan">
      <div id="xml-cache-stats"></div>

      <section class="panel panel--nested panel--cache-update">
        <h3 class="panel__subheading">Aggiorna cache</h3>
        <p class="hint panel__hint">Scarica e analizza metadata XML dal registry.</p>
        <div class="scan-actions">
          <button type="button" class="btn btn--block" data-scan="ALL">Tutto il registro <span id="scan-hint-full" class="muted"></span></button>
          <button type="button" class="btn btn-secondary btn--block" data-scan="page">Pagina corrente <span id="scan-hint-page" class="muted"></span></button>
          <button type="button" class="btn btn-secondary btn--block" data-scan="SP">SP (non aggregati) <span id="scan-hint-sp" class="muted"></span></button>
          <button type="button" class="btn btn-secondary btn--block" data-scan="AG">Aggregati <span id="scan-hint-ag" class="muted"></span></button>
          <button type="button" class="btn btn-secondary btn--block" data-scan="IDP">IdP <span id="scan-hint-idp" class="muted"></span></button>
          <button type="button" class="btn btn-secondary btn--block" id="validate-selected-btn">Aggiorna selezionato</button>
        </div>
      </section>

      <section class="panel panel--nested panel--cache-transfer">
        <h3 class="panel__subheading">Esporta e importa</h3>
        <p class="hint panel__hint">Backup o ripristino della cache locale in JSON.</p>
        <div class="cache-io">
          <button type="button" class="btn btn-secondary btn--block" id="cache-export-btn">Esporta</button>
          <button type="button" class="btn btn-secondary btn--block" id="cache-import-merge-btn">Importa (unisci)</button>
          <button type="button" class="btn btn-secondary btn--block" id="cache-import-replace-btn">Importa (sostituisci)</button>
          <button type="button" class="btn btn-secondary btn--block" id="cache-default-btn">Carica predefinita</button>
          <input type="file" id="cache-import-input" accept="application/json,.json" hidden />
        </div>
        <p id="cache-io-status" class="cache-io-status" hidden></p>
      </section>

      <h2 class="panel__footer-heading">Cache e validazione XML</h2>
      <p class="hint panel__footer-hint">La cache locale si costruisce <strong>scaricando i metadata XML dal registry</strong>. Validazione estensioni SPID; aggiornamento 24h.</p>

      <div id="xml-scan-progress" class="scan-progress" hidden>
        <div class="scan-progress__header">
          <span id="scan-status-text" class="scan-status-text">In attesa…</span>
          <button type="button" class="btn btn-secondary btn--small" id="scan-abort-btn" hidden>Interrompi</button>
        </div>
        <div id="scan-progress-bar" class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div id="scan-progress-fill" class="progress-bar__fill"></div>
        </div>
        <p id="scan-meta-text" class="scan-meta"></p>
        <p id="scan-entity-text" class="scan-entity" hidden></p>
        <div id="scan-log" class="scan-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      </div>
    </section>
  `;
}
