import {
  hasEidasExtension as hasEidasHeuristic,
  hasFirmaExtension as hasFirmaHeuristic,
  hasMinoriHeuristic,
  hasProfessionalExtension as hasProfessionalHeuristic,
  matchesSearchJson,
} from './extension-heuristics.js';
import { cacheEntryHasExtension } from './extension-xml.js';
import { getCachedEntry, isStale } from './metadata-cache.js';

const EXTENSION_ROWS = [
  { key: 'minori', label: 'SPID minori', idpOnly: false, spOnly: false },
  { key: 'professionale', label: 'SPID professionale', idpOnly: false, spOnly: false },
  { key: 'firma', label: 'Firma con SPID', idpOnly: false, spOnly: true },
  { key: 'eidas', label: 'eIDAS', idpOnly: false, spOnly: true },
];

function cacheHaystack(entry) {
  const parts = [entry.entityId, 'spid', 'estensioni'];
  if (entry.purposes?.length) parts.push(...entry.purposes, 'purpose', 'professionale');
  if (entry.flags?.minoriXml) parts.push('minori', 'age', 'AgeLimit', 'SupportedAgeLimit');
  if (entry.flags?.firmaXml) parts.push('firma', 'ACS', '77', 'sottoscrizione');
  if (entry.flags?.professionaleXml) parts.push('professionale', 'pro', 'PG', 'PF');
  if (entry.flags?.eidasXml) parts.push('eidas', '99', '100');
  for (const al of entry.ageLimits || []) {
    parts.push(al.acsIndex, al.minAge, al.maxAge, al.ageParentAuth);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Ricerca su campi JSON API e su dati in cache XML. */
export function matchesSearchDual(entity, query, entityType) {
  if (!query?.trim()) return true;

  const q = query.trim().toLowerCase();
  if (matchesSearchJson(entity, q)) return true;

  const cached = getCachedEntry(entity?.entity_id);
  if (cached && cacheHaystack(cached).includes(q)) return true;

  return false;
}

/**
 * Estensione rilevata nel JSON API (euristiche su payload API, non flag XML in cache).
 * Per voci solo cache XML (_fromCacheOnly) il lato JSON è sempre assente.
 */
export function jsonExtensionPresent(entity, entityType, ext) {
  if (entity?._fromCacheOnly) return false;
  switch (ext) {
    case 'minori':
      return hasMinoriHeuristic(entity, entityType);
    case 'professionale':
      return hasProfessionalHeuristic(entity, entityType);
    case 'firma':
      return entityType !== 'IDP' && hasFirmaHeuristic(entity, entityType);
    case 'eidas':
      return entityType !== 'IDP' && hasEidasHeuristic(entity);
    default:
      return false;
  }
}

function xmlExtensionPresent(cached, ext) {
  if (!cached) return null;
  return cacheEntryHasExtension(cached, ext);
}

function asymmetryDetail(ext, json, xml, cached, entityType) {
  switch (ext) {
    case 'minori':
      return xml
        ? 'XML: estensione minori presente · JSON API: nessuna traccia'
        : 'JSON API: euristica minori · XML: estensione minori assente';
    case 'professionale': {
      const purposes = (cached?.purposes || []).join(', ') || '—';
      return xml
        ? `XML: estensione professionale (${purposes}) · JSON API: assente`
        : 'JSON API: professionale · XML: estensione professionale assente';
    }
    case 'firma':
      return xml
        ? 'XML: AttributeConsumingService index 77 · JSON API: ACS #77 non presente'
        : 'JSON API: ACS #77 nel JSON · XML: ACS 77 non rilevato';
    case 'eidas':
      return xml
        ? 'XML: ACS index 99/100 · JSON API: eidas_ready ≠ Y'
        : 'JSON API: eidas_ready = Y · XML: ACS 99/100 assenti';
    default:
      return json !== xml ? 'Valori JSON API e XML non allineati' : '';
  }
}

function extensionRowsForType(entityType) {
  return EXTENSION_ROWS.filter((row) => {
    if (entityType === 'IDP') return row.key === 'minori' || row.key === 'professionale';
    return true;
  });
}

/**
 * Confronto estensioni JSON API ↔ metadata XML (stessa logica in lista e dettaglio).
 * @returns {{ hasCache: boolean, rows: { key: string, label: string, json: boolean, xml: boolean|null }[], asymmetries: { label: string, detail: string }[] }}
 */
export function getExtensionCoherence(entity, entityType, cached = getCachedEntry(entity?.entity_id)) {
  const rows = extensionRowsForType(entityType).map(({ key, label }) => ({
    key,
    label,
    json: jsonExtensionPresent(entity, entityType, key),
    xml: xmlExtensionPresent(cached, key),
  }));

  const asymmetries = [];

  if (!cached) {
    const jsonSignals = rows.filter((r) => r.json).map((r) => r.label);
    if (jsonSignals.length) {
      asymmetries.push({
        label: 'JSON senza XML in cache',
        detail: `Il JSON API suggerisce: ${jsonSignals.join(', ')}. Eseguire «Aggiorna selezionato» o una scansione XML.`,
      });
    }
    return { hasCache: false, rows, asymmetries };
  }

  for (const row of rows) {
    if (row.json === row.xml) continue;
    asymmetries.push({
      label: row.label,
      detail: asymmetryDetail(row.key, row.json, row.xml, cached, entityType),
    });
  }

  if (isStale(cached)) {
    asymmetries.push({
      label: 'Cache >24h',
      detail: 'Metadata XML in cache scaduto; rieseguire validazione per conferma.',
    });
  }

  return { hasCache: true, rows, asymmetries };
}

/**
 * Asimmetrie tra JSON API e metadata XML in cache per un singolo entity ID.
 * @returns {{ label: string, detail: string }[]}
 */
export function getEntityAsymmetries(entity, entityType, cached = getCachedEntry(entity?.entity_id)) {
  return getExtensionCoherence(entity, entityType, cached).asymmetries;
}
