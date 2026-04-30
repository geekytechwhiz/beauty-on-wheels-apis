import * as hl7Fhir from 'fhir-tool';
import { validateWithHapi } from './hapiValidator';

const fhirValidator = new hl7Fhir.Fhir();

function collectEmptyStringIssues(node: unknown, path: string, issues: string[]): void {
  if (typeof node === 'string') {
    if (node.trim() === '') {
      issues.push(path);
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      collectEmptyStringIssues(item, `${path}[${index}]`, issues);
    });
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
    if (key.startsWith('_')) {
      return;
    }
    const nextPath = path ? `${path}.${key}` : key;
    collectEmptyStringIssues(value, nextPath, issues);
  });
}

function throwOnEmptyPrimitiveStrings(resource: unknown): void {
  const issues: string[] = [];
  const root =
    resource && typeof resource === 'object' && typeof (resource as { resourceType?: unknown }).resourceType === 'string'
      ? String((resource as { resourceType: string }).resourceType)
      : 'resource';

  collectEmptyStringIssues(resource, root, issues);

  if (issues.length > 0) {
    throw new Error(
      `FHIR validation failed: properties cannot be empty strings at ${issues[0]}`
    );
  }
}

export async function validateWithHl7(resource: unknown): Promise<void> {
  const result = fhirValidator.validate(resource as object);

  if (!result.valid) {
    const firstError = result.messages.find(
      (message) => message.severity === 'error' || message.severity === 'fatal'
    );

    const message =
      firstError?.message ??
      result.messages[0]?.message ??
      'FHIR validation failed for response payload';

    throw new Error(message);
  }

  throwOnEmptyPrimitiveStrings(resource);
  await validateWithHapi(resource);
}
