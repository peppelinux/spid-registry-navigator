export const API_BASE = 'https://registry.spid.gov.it';
export const SPID_NS = 'https://spid.gov.it/saml-extensions';
export const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
export const CACHE_KEY = 'spid-saml2-federation-search-engine-metadata-v1';
/** Totali entity ID nel registro (persistiti, senza scadenza). */
export const REGISTRY_TOTALS_KEY = 'spid-nav-registry-totals:v1';
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Cache predefinita versionata nel repo (public/data/). */
export const DEFAULT_CACHE_PATH = 'data/metadata-cache-default.json';
/** Totali registry pre-calcolati (public/data/). */
export const DEFAULT_REGISTRY_TOTALS_PATH = 'data/registry-totals-default.json';
export const PROFESSIONAL_PURPOSES = new Set(['PG', 'PF', 'LP', 'PX']);
export const PROFESSIONAL_ATTRS = new Set([
  'companyName',
  'companyFiscalNumber',
  'ivaCode',
  'registeredOffice',
]);
