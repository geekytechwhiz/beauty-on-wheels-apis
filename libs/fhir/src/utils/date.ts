/**
 * FHIR Date Utilities
 * All dates must be ISO 8601 format
 */

/**
 * Convert a date string or timestamp to ISO 8601 date (YYYY-MM-DD)
 */
export function toFhirDate(value: string | number | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString().split('T')[0];
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString().split('T')[0];
  }

  return undefined;
}

/**
 * Convert a date string or timestamp to ISO 8601 dateTime
 */
export function toFhirDateTime(value: string | number | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString();
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString();
  }

  return undefined;
}

/**
 * Get current date in FHIR format (YYYY-MM-DD)
 */
export function getCurrentFhirDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get current dateTime in FHIR format (ISO 8601)
 */
export function getCurrentFhirDateTime(): string {
  return new Date().toISOString();
}

