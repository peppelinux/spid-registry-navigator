import { PROFESSIONAL_ATTRS, PROFESSIONAL_PURPOSES } from './constants.js';

export function matchesSearchJson(entity, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  const haystack = [
    entity.entity_id,
    entity.organization_name,
    entity.organization_display_name,
    entity.code,
    entity.aggregator_code,
    entity.aggregator_name,
    entity.file_name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function hasMinoriHeuristic(entity, entityType) {
  if (entityType === 'IDP') {
    const ext = entity?.extensions || {};
    return Boolean(ext.supported_age_limit || ext.supportedAgeLimit);
  }

  const services = entity?.attribute_consuming_service || [];
  const attrs = new Set(services.flatMap((acs) => acs.RequestedAttribute || []));
  if (attrs.has('age') || attrs.has('ageRange')) return true;

  const id = (entity?.entity_id || '').toLowerCase();
  return id.includes('minori') || id.includes('minor');
}

export function hasEidasExtension(entity) {
  return entity?.eidas_ready === 'Y';
}

export function hasFirmaExtension(entity) {
  const services = entity?.attribute_consuming_service || [];
  return services.some((acs) => acs.index === 77);
}

export function hasProfessionalExtension(entity, entityType) {
  if (entityType === 'IDP') {
    const purposes = entity?.extensions?.supported_purpose || [];
    return purposes.some((p) => PROFESSIONAL_PURPOSES.has(p));
  }

  const services = entity?.attribute_consuming_service || [];
  return services.some((acs) => {
    const name = (acs.ServiceName || '').toLowerCase();
    const attrs = acs.RequestedAttribute || [];
    return name === 'pro' || attrs.some((a) => PROFESSIONAL_ATTRS.has(a));
  });
}
