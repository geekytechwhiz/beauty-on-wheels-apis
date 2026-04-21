import { ValidationError } from '../domain/errors';

const METADATA_TYPE_CODE = /^[A-Z][A-Za-z0-9]*$/;
const METADATA_VALUE_CODE = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;
const ENUM_TOKEN = /^[A-Z][A-Z0-9_]*$/;

export function assertMetadataTypeCode(code: string, field = 'metadataTypeCode'): void {
  if (!METADATA_TYPE_CODE.test(code)) {
    throw new ValidationError(`Invalid metadataTypeCode`, [{ field, message: 'Must match ^[A-Z][A-Za-z0-9]*$' }]);
  }
}

export function assertMetadataValueCode(code: string, field = 'valueCode'): void {
  if (!METADATA_VALUE_CODE.test(code)) {
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
