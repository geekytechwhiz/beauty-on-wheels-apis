import Ajv, { type ErrorObject } from 'ajv';
import { MetadataValidationError } from '../domain/errors';

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

export function assertValueAttributesMatchSchema(
  valueAttributes: Record<string, unknown>,
  attributeSchema: Record<string, unknown> | undefined,
): void {
  if (attributeSchema === undefined || Object.keys(attributeSchema).length === 0) {
    return;
  }
  const validate = ajv.compile(attributeSchema);
  const ok = validate(valueAttributes);
  if (!ok && validate.errors) {
    const details = formatAjvErrors(validate.errors);
    throw new MetadataValidationError('valueAttributes do not match attributeSchema', details);
  }
}

function formatAjvErrors(errors: ErrorObject[]): Array<{ field?: string; message: string }> {
  return errors.map((e) => ({
    field: e.instancePath || e.schemaPath,
    message: e.message ?? 'validation error',
  }));
}
