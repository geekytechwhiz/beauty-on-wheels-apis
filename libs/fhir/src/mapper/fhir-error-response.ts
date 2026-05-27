import type { APIGatewayProxyResult } from 'aws-lambda';

import { buildOperationOutcome } from '../validator/operation-outcome.builder';
import { FhirValidationError } from '../validator/fhir.validator';
import type { Logger } from '@api-hub/observability';
import { serializeError } from '@api-hub/observability';

export interface FhirErrorResponseOptions {
  correlationId?: string;
  logger?: Logger;
  skipLog?: boolean;
}

/**
 * Maps {@link FhirValidationError} to a FHIR OperationOutcome HTTP response.
 */
export function fhirValidationErrorResponse(
  error: FhirValidationError,
  options: FhirErrorResponseOptions = {},
): APIGatewayProxyResult {
  const { correlationId, logger, skipLog } = options;
  const requestId = correlationId ?? 'unknown';

  if (logger && !skipLog) {
    logger.error({
      event: 'fhir_validation_error',
      requestId,
      statusCode: error.statusCode,
      errorCode: error.code,
      error: serializeError(error),
    });
  }

  const outcome = buildOperationOutcome(error.issues, error.resourceType);

  return {
    statusCode: error.statusCode,
    headers: {
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify(outcome),
  };
}

export { FhirValidationError };
