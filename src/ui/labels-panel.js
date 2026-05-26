import { baseUrl } from '../lib/base-url.js';

let markedLib;

async function getMarked() {
  if (!markedLib) {
    const mod = await import('https://cdn.jsdelivr.net/npm/marked@15.0.7/+esm');
    markedLib = mod.marked;
  }
  return markedLib;
}

export async function openLabelsPanel() {
  const panel = document.getElementById('labels-panel');
  const body = document.getElementById('labels-panel-body');
  if (!panel || !body) return;

  panel.hidden = false;
  document.body.classList.add('labels-panel-open');

  if (body.dataset.loaded === 'true') return;

  body.innerHTML = '<p class="labels-panel__loading">Caricamento documentazione…</p>';

  try {
    const res = await fetch(baseUrl('docs/LABELS.md'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const md = await res.text();
    const marked = await getMarked();
    body.innerHTML = marked.parse(md, { gfm: true });
    body.dataset.loaded = 'true';
  } catch (err) {
    body.innerHTML = `<p class="labels-panel__error">Impossibile caricare la guida (${err.message}). <a href="${baseUrl('labels.html')}" target="_blank" rel="noopener">Apri pagina dedicata</a>.</p>`;
  }
}

export function closeLabelsPanel() {
  const panel = document.getElementById('labels-panel');
  if (panel) panel.hidden = true;
  document.body.classList.remove('labels-panel-open');
}

export function bindLabelsPanel() {
  document.getElementById('labels-help')?.addEventListener('click', (e) => {
    e.preventDefault();
    openLabelsPanel();
  });

  document.getElementById('labels-panel-close')?.addEventListener('click', () => {
    closeLabelsPanel();
  });

  document.getElementById('labels-panel-backdrop')?.addEventListener('click', () => {
    closeLabelsPanel();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLabelsPanel();
  });
}
