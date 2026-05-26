import { API_BASE, MD_NS, PROFESSIONAL_ATTRS, SPID_NS } from './constants.js';
import { encodeEntityId } from './registry.js';

function localName(el) {
  return el.localName || el.tagName.split(':').pop();
}

function childText(parent, name) {
  for (const el of parent.getElementsByTagNameNS(SPID_NS, name)) {
    return el.textContent?.trim() || null;
  }
  for (const el of parent.getElementsByTagName('*')) {
    if (localName(el) === name) return el.textContent?.trim() || null;
  }
  return null;
}

function parseAgeLimitElement(al) {
  return {
    acsIndex: childText(al, 'AssertionConsumerServiceIndex'),
    minAge: childText(al, 'MinAge'),
    maxAge: childText(al, 'MaxAge'),
    ageParentAuth: childText(al, 'AgeParentAuth'),
  };
}

/**
 * @param {string} xmlText
 * @param {string} [expectedEntityId]
 */
export function parseEntityMetadataXml(xmlText, expectedEntityId) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Metadata XML non valido');
  }

  let descriptors = [...doc.getElementsByTagNameNS(MD_NS, 'EntityDescriptor')];
  if (!descriptors.length) {
    descriptors = [...doc.getElementsByTagName('*')].filter(
      (el) => localName(el) === 'EntityDescriptor',
    );
  }

  const target =
    descriptors.find((ed) => ed.getAttribute('entityID') === expectedEntityId) ||
    descriptors[0];

  if (!target) return null;

  return parseEntityDescriptor(target);
}

export function parseEntityDescriptor(ed) {
  const entityId = ed.getAttribute('entityID') || '';

  const ageLimits = [...ed.getElementsByTagNameNS(SPID_NS, 'AgeLimit')].map(parseAgeLimitElement);

  const purposes = [];
  for (const spidEl of ed.getElementsByTagNameNS(SPID_NS, '*')) {
    if (localName(spidEl) === 'Purpose' && spidEl.textContent?.trim()) {
      purposes.push(spidEl.textContent.trim());
    }
  }

  const supportedAgeLimit =
    ed.getElementsByTagNameNS(SPID_NS, 'SupportedAgeLimit').length > 0;

  let hasAcs77 = false;
  let hasEidasAcs = false;
  let hasProfessionalAcs = false;
  for (const acs of ed.getElementsByTagNameNS(MD_NS, 'AttributeConsumingService')) {
    const idx = acs.getAttribute('index');
    if (idx === '77') hasAcs77 = true;
    if (idx === '99' || idx === '100') hasEidasAcs = true;
    if (!hasProfessionalAcs && acsIsProfessional(acs)) hasProfessionalAcs = true;
  }

  return {
    entityId,
    ageLimits,
    hasAgeLimit: ageLimits.length > 0,
    supportedAgeLimit,
    hasAcs77,
    hasEidasAcs,
    hasProfessionalAcs,
    purposes,
    scannedAt: new Date().toISOString(),
  };
}

function acsIsProfessional(acs) {
  for (const attr of acs.getElementsByTagNameNS(MD_NS, 'RequestedAttribute')) {
    const name = attr.getAttribute('Name') || attr.getAttribute('name');
    if (name && PROFESSIONAL_ATTRS.has(name)) return true;
  }
  for (const sn of acs.getElementsByTagNameNS(MD_NS, 'ServiceName')) {
    if (sn.textContent?.trim().toLowerCase() === 'pro') return true;
  }
  return false;
}

/** EntityDescriptor figli diretti del bundle (una pagina API = N entity ID, non 1). */
function entityDescriptorsInBundle(doc) {
  const containers = [...doc.getElementsByTagNameNS(MD_NS, 'EntitiesDescriptor')];
  const container = containers[0] || doc.documentElement;

  const direct = [...container.children].filter(
    (el) => el.namespaceURI === MD_NS && localName(el) === 'EntityDescriptor',
  );
  if (direct.length) return direct;

  let descriptors = [...doc.getElementsByTagNameNS(MD_NS, 'EntityDescriptor')];
  if (!descriptors.length) {
    descriptors = [...doc.getElementsByTagName('*')].filter(
      (el) => localName(el) === 'EntityDescriptor',
    );
  }
  return descriptors;
}

/** Estrae tutti gli EntityDescriptor da un bundle XML (pagina registry). */
export function parseAllFromBundle(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Bundle metadata XML non valido');
  }

  return entityDescriptorsInBundle(doc)
    .map((ed) => parseEntityDescriptor(ed))
    .filter((p) => p.entityId);
}

export async function fetchEntityXml(entityId, signal) {
  const response = await fetch(`${API_BASE}/entities/${encodeEntityId(entityId)}`, {
    headers: { Accept: 'application/samlmetadata+xml' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

export async function fetchPageXml({ entityType, federationType, page, pageSize = 50, signal }) {
  const url = new URL(`${API_BASE}/entities`);
  url.searchParams.set('entity_type', entityType);
  url.searchParams.set('page', String(page));
  url.searchParams.set('numMetadata', String(pageSize));
  if (federationType) url.searchParams.set('federation_type', federationType);

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/samlmetadata+xml' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    xml: await response.text(),
    /** Documenti metadata nel registro (header tot-metadata), ≠ entity ID distinti. */
    totMetadata: Number(response.headers.get('tot-metadata') || 0),
    pages: Number(response.headers.get('tot-pages') || 0),
    page: Number(response.headers.get('current-page') || page),
  };
}
