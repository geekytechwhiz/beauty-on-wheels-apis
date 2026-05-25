import {
  MappingField,
  ResourceMappingConfig,
} from '../registry/mapping.registry';

export function mergeMappings(
  base: ResourceMappingConfig,
  clientOverride?: ResourceMappingConfig,
): ResourceMappingConfig {
  if (!clientOverride?.fields?.length) {
    return base;
  }

  const overridesByTarget = new Map<string, MappingField>(
    clientOverride.fields.map((field) => [field.target, field]),
  );

  const mergedFields: MappingField[] = [];
  const seenTargets = new Set<string>();

  for (const field of base.fields) {
    mergedFields.push(overridesByTarget.get(field.target) ?? field);
    seenTargets.add(field.target);
  }

  for (const field of clientOverride.fields) {
    if (!seenTargets.has(field.target)) {
      mergedFields.push(field);
      seenTargets.add(field.target);
    }
  }

  return {
    resource: base.resource,
    version: base.version,
    profile: clientOverride.profile ?? base.profile,
    fields: mergedFields,
    extensions: clientOverride.extensions ?? base.extensions,
  };
}
