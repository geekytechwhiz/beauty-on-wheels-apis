/**
 * Duck-type check for {@link FhirValidationError} without importing the class.
 */
export function isFhirValidationErrorLike(error: unknown): error is {
  code: string;
  statusCode: number;
  issues: unknown[];
} {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  return (
    candidate.code === 'FHIR_VALIDATION_FAILED' &&
    Array.isArray(candidate.issues) &&
    typeof candidate.statusCode === 'number'
  );
}
