import objectPath from 'object-path';

import {
  ResourceMappingConfig,
  MappingField,
} from '../registry/mapping.registry';

import {
  defaultTerminologyService,
  TerminologyService,
} from '../terminology/terminology.service';

import { buildExtensions, mergeExtensions } from './extension.builder';

type AnyObject = Record<string, unknown>;

export class GenericMapper {
  constructor(
    private readonly terminology: TerminologyService =
      defaultTerminologyService,
  ) {}

  /**
   * Canonical → FHIR (strict: only mapped fields)
   */
  map(canonical: AnyObject, mapping: ResourceMappingConfig): AnyObject {
    return this.mapStrict(canonical, mapping);
  }

  /**
   * Canonical → strict FHIR resource.
   * Only mapped FHIR paths and approved extensions; no canonical field passthrough.
   */
  mapStrict(
    canonical: AnyObject,
    mapping: ResourceMappingConfig,
  ): AnyObject {
    const resource: AnyObject = {
      resourceType: mapping.resource,
    };

    for (const field of mapping.fields) {
      this.applyFieldMapping(resource, canonical, field);
    }

    const builtExtensions = buildExtensions(canonical, mapping.extensions);
    if (builtExtensions.length > 0) {
      resource.extension = builtExtensions;
    }

    return resource;
  }

  /**
   * Canonical → hybrid FHIR-compatible payload.
   * Preserves all canonical fields and adds mapped FHIR paths + extensions.
   */
  mapHybrid(canonical: AnyObject, mapping: ResourceMappingConfig): AnyObject {
    const hybrid = structuredClone(canonical) as AnyObject;

    for (const field of mapping.fields) {
      this.applyFieldMapping(hybrid, canonical, field);
    }

    const builtExtensions = buildExtensions(canonical, mapping.extensions);
    const mergedExtensions = mergeExtensions(
      hybrid.extension as Parameters<typeof mergeExtensions>[0],
      builtExtensions,
    );

    if (mergedExtensions.length > 0) {
      hybrid.extension = mergedExtensions;
    }

    hybrid.resourceType = mapping.resource;

    return hybrid;
  }

  /**
   * FHIR → Canonical
   */
  reverseMap(resource: AnyObject, mapping: ResourceMappingConfig): AnyObject {
    const canonical: AnyObject = {};

    for (const field of mapping.fields) {
      let value = objectPath.get(resource, field.target);

      if (value === undefined) {
        continue;
      }

      if (field.fieldType === 'reference' && typeof value === 'string') {
        value = value.split('/').pop();
      }

      if (field.system && typeof value === 'string') {
        value = this.terminology.reverseNormalizeCode(field.system, value);
      }

      objectPath.set(canonical, field.source, value);
    }

    return canonical;
  }

  private applyFieldMapping(
    resource: AnyObject,
    canonical: AnyObject,
    field: MappingField,
  ): void {
    let value: unknown;

    if (field.defaultValue !== undefined) {
      value = field.defaultValue;
    } else {
      value = objectPath.get(canonical, field.source);
    }

    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === 'object') {
      value = structuredClone(value);
    }

    value = this.applyTemplate(value, field);

    if (field.system && typeof value === 'string') {
      value = this.terminology.normalizeCode(field.system, value).code;
    }

    value = this.applyTransform(value, field);

    objectPath.set(resource, field.target, value);
  }

  private applyTemplate(value: unknown, field: MappingField): unknown {
    if (!field.template) {
      return value;
    }

    return field.template.replace('{{value}}', String(value));
  }

  private applyTransform(value: unknown, field: MappingField): unknown {
    if (!field.transform) {
      return value;
    }

    switch (field.transform) {
      case 'firstName':
        return String(value).split(' ')[0];

      case 'lastName':
        return String(value).split(' ').slice(1).join(' ');

      case 'dateOfBirth':
        return normalizeDateOfBirth(String(value));

      default:
        return value;
    }
  }
}

/**
 * Normalizes common date formats to ISO YYYY-MM-DD.
 * Handles DD-MM-YYYY (e.g. "12-07-1997") and passes through ISO dates.
 */
export function normalizeDateOfBirth(value: string): string {
  const ddMmYyyy = /^(\d{2})-(\d{2})-(\d{4})$/;
  const match = value.match(ddMmYyyy);

  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  return value;
}
