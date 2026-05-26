import { PROFESSIONAL_PURPOSES } from './constants.js';

/** @param {'minori'|'firma'|'professionale'|'eidas'} ext */
export function cacheEntryHasExtension(entry, ext) {
  if (!entry) return false;
  switch (ext) {
    case 'minori':
      return Boolean(entry.flags?.minoriXml);
    case 'firma':
      return Boolean(entry.flags?.firmaXml);
    case 'professionale':
      if (entry.entityType === 'IDP') {
        return (entry.purposes || []).some((p) => PROFESSIONAL_PURPOSES.has(p));
      }
      return Boolean(entry.flags?.professionaleXml);
    case 'eidas':
      return Boolean(entry.flags?.eidasXml);
    default:
      return false;
  }
}

export function cacheEntryHasAnyExtension(entry) {
  return (
    cacheEntryHasExtension(entry, 'minori') ||
    cacheEntryHasExtension(entry, 'firma') ||
    cacheEntryHasExtension(entry, 'professionale') ||
    cacheEntryHasExtension(entry, 'eidas')
  );
}

export function parsedHasSpidExtensions(parsed, entityType) {
  const pro =
    entityType === 'IDP'
      ? (parsed.purposes || []).some((p) => PROFESSIONAL_PURPOSES.has(p))
      : parsed.hasProfessionalAcs;
  return Boolean(
    parsed.hasAgeLimit ||
      parsed.supportedAgeLimit ||
      parsed.hasAcs77 ||
      parsed.hasEidasAcs ||
      pro,
  );
}
