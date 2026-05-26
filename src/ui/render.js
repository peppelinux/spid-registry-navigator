import { isStale } from '../api/metadata-cache.js';
import { getExtensionCoherence } from '../api/entity-consistency.js';
import { cacheEntryHasExtension } from '../api/extension-xml.js';
import {
  apidocUrl,
  entityDetailUrl,
  entityXmlUrl,
  getAggregatorVariant,
  getMinoriBadgeKind,
  hasEidasExtension,
  hasFirmaExtension,
  hasMinoriExtension,
  hasProfessionalExtension,
} from '../api/registry.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function badge(text, className = '') {
  return `<span class="badge ${className}">${escapeHtml(text)}</span>`;
}

export function renderEntityBadges(entity, entityType) {
  const badges = [];
  badges.push(badge(entity.federation_type || entityType, 'badge-type'));

  const variant = getAggregatorVariant(entity);
  if (variant) badges.push(badge(`aggregatore ${variant}`, 'badge-ag'));

  if (hasProfessionalExtension(entity, entityType)) {
    badges.push(badge('professionale', 'badge-pro'));
  }
  if (hasFirmaExtension(entity, entityType)) {
    badges.push(badge('firma', 'badge-firma'));
  }
  const minori = getMinoriBadgeKind(entity, entityType);
  if (minori.show) {
    const label =
      minori.kind === 'xml' || minori.kind === 'xml-index'
        ? 'minori (xml)'
        : 'minori (?)';
    badges.push(
      badge(label, minori.stale ? 'badge-minori badge-stale' : 'badge-minori'),
    );
  }
  if (hasEidasExtension(entity, entityType)) {
    badges.push(badge('eIDAS', 'badge-eidas'));
  }
  if (entity._disabled === 'Y') {
    badges.push(badge('disabilitato', 'badge-warn'));
  }
  if (entity._deleted === 'Y') {
    badges.push(badge('cancellato', 'badge-warn'));
  }

  return badges.join('');
}

function renderAsymmetryBlock(entity, entityType) {
  const cached = entity._cache;
  const { asymmetries } = getExtensionCoherence(entity, entityType, cached);
  if (!asymmetries.length) return '';
  return `<ul class="entity-asym" aria-label="Asimmetrie JSON vs XML">
    ${asymmetries
      .map(
        (a) =>
          `<li class="entity-asym__item" title="${escapeHtml(a.detail)}">⚠ ${escapeHtml(a.label)}: ${escapeHtml(a.detail)}</li>`,
      )
      .join('')}
  </ul>`;
}

export function renderEntityRow(entity, entityType, selectedId) {
  const selected = entity.entity_id === selectedId ? 'is-selected' : '';
  const title = entity.organization_display_name || entity.organization_name || entity.entity_id;
  const subtitle = entity.aggregator_name
    ? `${entity.aggregator_name} · ${entity.code || ''}`
    : entity.code ||
      (entity._fromCacheOnly ? 'solo cache XML — apri per dettaglio API' : entity.entity_id);

  return `
    <button type="button" class="entity-row ${selected}" data-entity-id="${escapeHtml(entity.entity_id)}">
      <div class="entity-row__title">${escapeHtml(title)}</div>
      <div class="entity-row__meta">${escapeHtml(subtitle)}</div>
      <div class="entity-row__badges">${renderEntityBadges(entity, entityType)}</div>
      ${renderAsymmetryBlock(entity, entityType)}
    </button>
  `;
}

export function renderEntityDetail(entity, entityType) {
  if (!entity) {
    return `<div class="detail-empty"><p>Seleziona un entity ID dalla lista.</p></div>`;
  }

  const title = entity.organization_display_name || entity.organization_name || entity.entity_id;
  const json = JSON.stringify(entity, null, 2);

  const acsHtml = (entity.attribute_consuming_service || [])
    .map(
      (acs) => `
      <li>
        <strong>#${acs.index}</strong> ${escapeHtml(acs.ServiceName || '—')}
        <span class="muted">${escapeHtml((acs.RequestedAttribute || []).join(', '))}</span>
      </li>`,
    )
    .join('');

  const idpExt = entity.extensions
    ? `<pre class="code-block">${escapeHtml(JSON.stringify(entity.extensions, null, 2))}</pre>`
    : '<p class="muted">Nessuna estensione esposta in JSON.</p>';

  const xmlSection = renderXmlCacheSection(entity, entityType);
  const asymSection = renderAsymmetryDetailSection(entity, entityType);

  return `
    <header class="detail-header">
      <h2>${escapeHtml(title)}</h2>
      <p class="detail-entity-id">${escapeHtml(entity.entity_id)}</p>
      <div class="detail-badges">${renderEntityBadges(entity, entityType)}</div>
      <div class="detail-actions">
        <a class="btn btn-secondary" href="${escapeHtml(entityDetailUrl(entity.entity_id))}" target="_blank" rel="noopener">JSON API</a>
        <a class="btn btn-secondary" href="${escapeHtml(entityXmlUrl(entity.entity_id))}" target="_blank" rel="noopener">Metadata XML</a>
        ${entity.registry_link ? `<a class="btn btn-secondary" href="${escapeHtml(entity.registry_link)}" target="_blank" rel="noopener">Registro</a>` : ''}
      </div>
    </header>

    <section class="detail-section">
      <h3>Informazioni</h3>
      <dl class="detail-dl">
        <dt>Tipo</dt><dd>${escapeHtml(entityType)} / ${escapeHtml(entity.federation_type || '—')}</dd>
        <dt>Codice</dt><dd>${escapeHtml(entity.code || '—')}</dd>
        <dt>Organizzazione</dt><dd>${escapeHtml(entity.organization_type || '—')}</dd>
        <dt>Aggregatore</dt><dd>${escapeHtml(entity.aggregator_name || '—')} (${escapeHtml(entity.aggregator_code || '—')})</dd>
        <dt>File</dt><dd>${escapeHtml(entity.file_name || '—')}</dd>
        <dt>Aggiornato</dt><dd>${escapeHtml(entity.lastupdate_date || '—')}</dd>
        <dt>eIDAS ready</dt><dd>${escapeHtml(entity.eidas_ready || '—')}</dd>
      </dl>
    </section>

    ${asymSection}
    ${xmlSection}

    ${
      entityType === 'IDP'
        ? `<section class="detail-section"><h3>Estensioni IdP (JSON API)</h3>${idpExt}</section>`
        : ''
    }

    ${
      acsHtml
        ? `<section class="detail-section"><h3>Attribute Consuming Service</h3><ul class="acs-list">${acsHtml}</ul></section>`
        : ''
    }

    <section class="detail-section">
      <h3>Payload JSON</h3>
      <pre class="code-block code-block--scroll">${escapeHtml(json)}</pre>
    </section>
  `;
}

function normalizeAggregatorNameKey(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('it');
}

function normalizeAggregatorCodeKey(code) {
  return String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** Chiave di raggruppamento: nome aggregatore se presente (evita duplicati per codici IPA/PIVA diversi). */
export function aggregatorGroupKey(entity) {
  const nameKey = normalizeAggregatorNameKey(entity.aggregator_name);
  if (nameKey) return `n:${nameKey}`;
  const codeKey = normalizeAggregatorCodeKey(entity.aggregator_code);
  if (codeKey) return `c:${codeKey}`;
  return '—';
}

function pickDisplayAggregatorName(items) {
  const counts = new Map();
  for (const entity of items) {
    const name = String(entity.aggregator_name ?? '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'it'),
  )[0][0];
}

function pickPrimaryAggregatorCode(items) {
  const counts = new Map();
  for (const entity of items) {
    const code = normalizeAggregatorCodeKey(entity.aggregator_code);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Raggruppa aggregati per soggetto aggregatore (ordinati). */
export function groupEntitiesByAggregator(entities) {
  const groups = new Map();
  for (const entity of entities) {
    const key = aggregatorGroupKey(entity);
    if (!groups.has(key)) {
      groups.set(key, { key, items: [], codeCounts: new Map() });
    }
    const group = groups.get(key);
    group.items.push(entity);
    const code = normalizeAggregatorCodeKey(entity.aggregator_code);
    if (code) group.codeCounts.set(code, (group.codeCounts.get(code) ?? 0) + 1);
  }

  return [...groups.values()]
    .map((group) => {
      const name = pickDisplayAggregatorName(group.items);
      const code = pickPrimaryAggregatorCode(group.items);
      const altCodeCount = group.codeCounts.size > 1 ? group.codeCounts.size - 1 : 0;
      return {
        key: group.key,
        name,
        code,
        altCodeCount,
        items: group.items.sort((a, b) =>
          (a.organization_name || a.entity_id || '').localeCompare(
            b.organization_name || b.entity_id || '',
            'it',
          ),
        ),
      };
    })
    .sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '', 'it'));
}

function aggregatorVariantCounts(items) {
  const full = items.filter((e) => getAggregatorVariant(e) === 'full').length;
  const light = items.filter((e) => getAggregatorVariant(e) === 'light').length;
  return { full, light };
}

/** Vista master–detail: picker aggregatori + elenco completo aggregati cliccabili. */
export function renderAggregatorView({ groups, selectedKey, selectedId, entityType }) {
  if (!groups.length) {
    return '<div class="list-placeholder">Nessun aggregatore per i filtri correnti.</div>';
  }

  const selected = groups.find((g) => g.key === selectedKey) || groups[0];
  const totalEntities = groups.reduce((n, g) => n + g.items.length, 0);
  const { full, light } = aggregatorVariantCounts(selected.items);
  const orphanGroup = groups.find((g) => g.key === '—');
  const missingMeta =
    orphanGroup && orphanGroup.items.length > totalEntities * 0.1
      ? `<p class="aggregator-picker__warn muted">Mancano i codici aggregatore in cache: eseguire <code>npm run build:cache:aggregators</code> e ricaricare il bundle.</p>`
      : '';

  return `
    <div class="aggregator-view">
      <aside class="aggregator-picker" role="listbox" aria-label="Aggregatori">
        <p class="aggregator-picker__head muted">
          ${groups.length} aggregatori · ${totalEntities} aggregati
        </p>
        ${missingMeta}
        ${groups
          .map((g) => {
            const stats = aggregatorVariantCounts(g.items);
            const active = g.key === selected.key ? 'is-active' : '';
            return `
          <button type="button" class="aggregator-picker__item ${active}" data-aggregator-key="${escapeHtml(g.key)}" role="option" aria-selected="${g.key === selected.key}">
            <span class="aggregator-picker__name">${escapeHtml(g.name || g.code || '—')}</span>
            <span class="aggregator-picker__meta">${g.items.length} aggregati · ${stats.full} full · ${stats.light} light${g.altCodeCount ? ` · ${g.altCodeCount + 1} codici` : ''}</span>
          </button>`;
          })
          .join('')}
      </aside>
      <section class="aggregator-entities">
        <header class="aggregator-entities__head">
          <h3 class="aggregator-entities__title">${escapeHtml(selected.name || selected.code || '—')}</h3>
          <p class="aggregator-entities__stats muted">${selected.items.length} aggregati · ${full} full · ${light} light</p>
          ${
            selected.code
              ? `<p class="aggregator-entities__code muted">${escapeHtml(selected.code)}${selected.altCodeCount ? ` · +${selected.altCodeCount} codici alternativi nel registro` : ''}</p>`
              : ''
          }
        </header>
        <div class="aggregator-entities__list" data-aggregator-list data-count="${selected.items.length}"></div>
      </section>
    </div>
  `;
}

export function apidocLinkHtml() {
  return `<a href="${apidocUrl()}" target="_blank" rel="noopener">API OpenAPI</a>`;
}

function ynCell(value) {
  if (value === null || value === undefined) return '—';
  return value ? 'sì' : 'no';
}

function renderAsymmetryDetailSection(entity, entityType) {
  const cached = entity._cache;
  const { hasCache, rows, asymmetries } = getExtensionCoherence(entity, entityType, cached);

  if (!hasCache) {
    return `
    <section class="detail-section detail-section--asym">
      <h3>Coerenza JSON API ↔ metadata XML</h3>
      <p class="muted">Metadata XML non ancora in cache. Usa «Aggiorna selezionato» o una scansione.</p>
      ${
        asymmetries.length
          ? `<ul class="asym-detail-list">${asymmetries
              .map(
                (a) =>
                  `<li><strong>${escapeHtml(a.label)}</strong><span>${escapeHtml(a.detail)}</span></li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </section>`;
  }

  const tableRows = rows
    .map(
      (r) =>
        `<tr class="${r.json !== r.xml ? 'coherence-row--mismatch' : ''}"><td>${escapeHtml(r.label)}</td><td>${ynCell(r.json)}</td><td>${ynCell(r.xml)}</td></tr>`,
    )
    .join('');

  const mismatchList =
    asymmetries.length > 0
      ? `<ul class="asym-detail-list">
        ${asymmetries
          .map(
            (a) =>
              `<li><strong>${escapeHtml(a.label)}</strong><span>${escapeHtml(a.detail)}</span></li>`,
          )
          .join('')}
      </ul>`
      : `<p class="muted">Nessuna asimmetria tra JSON API e metadata XML in cache.</p>`;

  return `
    <section class="detail-section detail-section--asym">
      <h3>Coerenza JSON API ↔ metadata XML</h3>
      <table class="xml-table coherence-table">
        <thead><tr><th>Estensione</th><th>JSON API</th><th>XML cache</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${mismatchList}
    </section>`;
}

function extLine(label, on) {
  return `<li><strong>${escapeHtml(label)}</strong>: ${on ? 'sì (XML)' : 'no'}</li>`;
}

function renderXmlCacheSection(entity, entityType) {
  const cached = entity._cache;
  if (!cached) {
    return `
    <section class="detail-section detail-section--xml">
      <h3>Estensioni (metadata XML)</h3>
      <p class="muted">Metadata non ancora in cache. Usa «Aggiorna selezionato» o una scansione.</p>
    </section>`;
  }

  const stale = isStale(cached);
  const scanned = new Date(cached.scannedAt).toLocaleString('it-IT');

  let extra = '';
  if (cached.ageLimits?.length) {
    const rows = cached.ageLimits
      .map(
        (al) =>
          `<tr><td>${escapeHtml(al.acsIndex || '—')}</td><td>${escapeHtml(al.minAge || '—')}</td><td>${escapeHtml(al.maxAge || '—')}</td><td>${escapeHtml(al.ageParentAuth || '—')}</td></tr>`,
      )
      .join('');
    extra = `
      <table class="xml-table">
        <thead><tr><th>ACS</th><th>MinAge</th><th>MaxAge</th><th>AgeParentAuth</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
  if (cached.purposes?.length) {
    extra += `<p class="muted">Purposes XML: ${escapeHtml(cached.purposes.join(', '))}</p>`;
  }

  return `
    <section class="detail-section detail-section--xml">
      <h3>Estensioni (metadata XML in cache)</h3>
      <p class="xml-scan-meta">
        Scansione: ${escapeHtml(scanned)}
        ${stale ? ' · <span class="badge badge-stale">cache &gt;24h</span>' : ' · <span class="badge badge-ok">cache valida</span>'}
      </p>
      <ul class="ext-xml-list">
        ${extLine('SPID minori', cacheEntryHasExtension(cached, 'minori'))}
        ${extLine('SPID professionale', cacheEntryHasExtension(cached, 'professionale'))}
        ${entityType !== 'IDP' ? extLine('Firma con SPID', cacheEntryHasExtension(cached, 'firma')) : ''}
      </ul>
      ${extra}
    </section>`;
}
