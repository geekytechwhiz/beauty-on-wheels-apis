import { ResourceMappingConfig } from '../registry/mapping.registry';

type AnyObject = Record<string, any>;

/** RHS in mapping JSON: use `__literal__:value` to set a constant (e.g. telecom system). */
export const FHIR_MAPPING_LITERAL_PREFIX = '__literal__:';

function ensureArray(target: AnyObject, key: string): any[] {
  if (!Array.isArray(target[key])) {
    target[key] = [];
  }
  return target[key];
}

function setFHIRField(resource: AnyObject, path: string, value: any): void {
  if (value === undefined) return;
  const segments = path.split('.');
  let current: AnyObject = resource;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);

    if (arrayMatch) {
      const [, prop, indexStr] = arrayMatch;
      const index = Number(indexStr);
      const arr = ensureArray(current, prop);
      if (i === segments.length - 1) {
        arr[index] = value;
      } else {
        if (!arr[index]) {
          arr[index] = {};
        }
        current = arr[index];
      }
    } else {
      if (i === segments.length - 1) {
        current[segment] = value;
      } else {
        if (!current[segment]) {
          current[segment] = {};
        }
        current = current[segment] as AnyObject;
      }
    }
  }
}

export class GenericFhirMapper {
  map(canonical: AnyObject, mapping: ResourceMappingConfig): AnyObject {
    const resource: AnyObject = {
      resourceType: mapping.resourceType,
    };

    for (const [fhirPath, canonicalField] of Object.entries(mapping.mappings)) {
      const raw = canonicalField as string;
      const value =
        typeof raw === 'string' && raw.startsWith(FHIR_MAPPING_LITERAL_PREFIX)
          ? raw.slice(FHIR_MAPPING_LITERAL_PREFIX.length)
          : (canonical as AnyObject)[raw];
      setFHIRField(resource, fhirPath, value);
    }

    return resource;
  }
}

