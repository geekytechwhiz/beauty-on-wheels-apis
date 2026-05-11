import { ValidationError } from '../domain/errors';

/** Single source of truth for metadata type codes (`MetadataTypeCode` API shape). */
export const METADATA_TYPE_CODE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

/** Single source of truth for metadata value codes (`valueCode` / `metadataValueCode`). */
export const METADATA_VALUE_CODE_PATTERN = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;

const ENUM_TOKEN = /^[A-Z][A-Z0-9_]*$/;

export function assertMetadataTypeCode(code: unknown, field = 'metadataTypeCode'): asserts code is string {
  if (typeof code !== 'string') {
    throw new ValidationError(`Invalid metadataTypeCode`, [{ field, message: 'Must be a string' }]);
  }
  if (!METADATA_TYPE_CODE_PATTERN.test(code)) {
    throw new ValidationError(`Invalid metadataTypeCode`, [{ field, message: 'Must match ^[A-Z][A-Za-z0-9]*$' }]);
  }
}

export function assertMetadataValueCode(code: string, field = 'valueCode'): void {
  if (!METADATA_VALUE_CODE_PATTERN.test(code)) {
    throw new ValidationError(`Invalid valueCode`, [{ field, message: 'Must match ^[A-Z0-9]+(_[A-Z0-9]+)*$' }]);
  }
}

export function assertEnumTokenArray(values: string[] | undefined, field: string): void {
  if (!values) {
    return;
  }
  for (const v of values) {
    if (!ENUM_TOKEN.test(v)) {
      throw new ValidationError(`Invalid ${field} token`, [{ field, message: 'Expected UPPER_SNAKE-style token' }]);
    }
  }
}
