import {
  MappingField,
  ResourceConfig,
} from '../types/resource.types';

export function mergeMappings(
  base: ResourceConfig,
  clientOverride?: ResourceConfig,
): ResourceConfig {
  if (!clientOverride?.fields?.length) {
    return base;
  }

  const overridesByTarget = new Map<string, MappingField>(
    clientOverride.fields.map((field) => [field.target, field]),
  );

  const mergedFields: MappingField[] = [];
  const seenTargets = new Set<string>();

  for (const field of base.fields ?? []) {
    mergedFields.push(overridesByTarget.get(field.target) ?? field);
    seenTargets.add(field.target);
  }

  for (const field of clientOverride.fields ?? []) {
    if (!seenTargets.has(field.target)) {
      mergedFields.push(field);
      seenTargets.add(field.target);
    }
  }

  return {
    resource: base.resource,
    version: base.version,
    profile: clientOverride.profile ?? base.profile,
    validation: base.validation,
    detection: base.detection,
    mapping: base.mapping,
    aliases: base.aliases,
    references: base.references, 
    transformers: base.transformers,
    clientOverrides: base.clientOverrides,
    metadata: base.metadata,
    fields: mergedFields,
    extensions: [
      ...(clientOverride.extensions ?? []),
      ...(base.extensions ?? [])
   ]
  };
}
