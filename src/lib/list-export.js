import { cacheEntryHasExtension } from '../api/extension-xml.js';
import { getAggregatorVariant } from '../api/registry.js';

const CSV_COLUMNS = [
  { key: 'entity_id', header: 'entity_id' },
  { key: 'organization_name', header: 'organization_name' },
  { key: 'organization_display_name', header: 'organization_display_name' },
  { key: 'code', header: 'code' },
  { key: 'federation_type', header: 'federation_type' },
  { key: 'eidas_ready_json', header: 'eidas_ready (JSON API)' },
  { key: 'ext_professionale_xml', header: 'SPID professionale (XML)' },
  { key: 'ext_firma_xml', header: 'Firma SPID (XML)' },
  { key: 'ext_minori_xml', header: 'SPID minori (XML)' },
  { key: 'ext_eidas_xml', header: 'eIDAS ACS 99/100 (XML)' },
  { key: 'aggregator_variant', header: 'variante_aggregatore' },
  { key: 'source', header: 'origine_dato' },
];

function extFlag(entity, entityType, ext) {
  const cached = entity._cache;
  if (!cached) return '';
  if (ext === 'firma' && entityType === 'IDP') return '';
  return cacheEntryHasExtension(cached, ext) ? 'Y' : 'N';
}

/** @param {object[]} entities @param {'IDP'|'SP'|'AG'} entityType */
export function entitiesToExportRows(entities, entityType) {
  return entities.map((entity) => ({
    entity_id: entity.entity_id ?? '',
    organization_name: entity.organization_name ?? '',
    organization_display_name: entity.organization_display_name ?? '',
    code: entity.code ?? '',
    federation_type: entity.federation_type ?? entityType,
    eidas_ready_json: entity.eidas_ready ?? '',
    ext_professionale_xml: extFlag(entity, entityType, 'professionale'),
    ext_firma_xml: extFlag(entity, entityType, 'firma'),
    ext_minori_xml: extFlag(entity, entityType, 'minori'),
    ext_eidas_xml: extFlag(entity, entityType, 'eidas'),
    aggregator_variant: getAggregatorVariant(entity) ?? '',
    source: entity._fromCacheOnly ? 'cache_xml' : 'api_json',
  }));
}

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/** @param {Record<string, string>[]} rows */
export function rowsToCsv(rows) {
  const header = CSV_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',');
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((c) => escapeCsvCell(row[c.key])).join(','),
  );
  return `\uFEFF${header}\n${lines.join('\n')}\n`;
}

/** @param {Record<string, string>[]} rows */
export function rowsToJsonBundle(rows, meta) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      source: 'spid-registry-navigator',
      ...meta,
      count: rows.length,
      rows,
    },
    null,
    2,
  );
}

export function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** @param {{ mode: string, filtered: boolean, count: number }} opts */
export function buildExportFilename({ mode, filtered, count, format }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = filtered ? 'filtrato' : 'categoria';
  const ext = format === 'json' ? 'json' : 'csv';
  return `spid-registry-${mode.toLowerCase()}-${scope}-${count}-righe-${stamp}.${ext}`;
}
