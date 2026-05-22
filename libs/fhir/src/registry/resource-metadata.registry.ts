import observationMetadata from '../generated/resources/R4/Observation.metadata.json';
import organizationMetadata from '../generated/resources/R4/Organization.metadata.json';
import patientMetadata from '../generated/resources/R4/Patient.metadata.json';

export interface ResourceFieldMetadata {
  path: string;
  type: string[];
  required: boolean;
  multiple: boolean;
}

export interface ResourceMetadata {
  resource: string;
  version: string;
  fields: ResourceFieldMetadata[];
}

const metadataRegistry: Record<string, Record<string, ResourceMetadata>> = {
  Patient: {
    R4: patientMetadata as ResourceMetadata,
  },
  Organization: {
    R4: organizationMetadata as ResourceMetadata,
  },
  Observation: {
    R4: observationMetadata as ResourceMetadata,
  },
};

/**
 * Top-level required elements only (e.g. Observation.status).
 * Nested backbone requirements are excluded so mapped resources stay valid.
 */
export function getRequiredFields(
  resourceType: string,
  version = 'R4',
): string[] {
  const metadata =
    metadataRegistry[resourceType]?.[version] ??
    metadataRegistry[resourceType]?.R4;

  if (!metadata) {
    return [];
  }

  const prefix = `${resourceType}.`;

  return metadata.fields
    .filter((field) => field.required)
    .filter((field) => isTopLevelField(field.path, prefix))
    .map((field) => toResourcePath(field.path, prefix));
}

function isTopLevelField(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) {
    return false;
  }

  const remainder = path.slice(prefix.length);
  return remainder.length > 0 && !remainder.includes('.');
}

function toResourcePath(path: string, prefix: string): string {
  return path.slice(prefix.length);
}
