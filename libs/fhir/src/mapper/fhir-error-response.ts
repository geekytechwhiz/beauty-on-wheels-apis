import type { APIGatewayProxyResult } from 'aws-lambda';

import { buildOperationOutcome } from '../validator/operation-outcome.builder';
import {
  FhirValidationError,
  type ValidationIssue,
} from '../validator/fhir.validator';
import type { Logger } from '@api-hub/observability';
import { serializeError } from '@api-hub/observability';

type FhirValidationErrorLike = {
  statusCode: number;
  code: string;
  issues: unknown[];
  resourceType?: string;
};

function normalizeValidationIssues(issues: unknown[]): ValidationIssue[] {
  return issues.map((issue) => {
    if (
      issue != null &&
      typeof issue === 'object' &&
      'diagnostics' in issue &&
      typeof (issue as ValidationIssue).diagnostics === 'string'
    ) {
      return issue as ValidationIssue;
    }

    const candidate = issue as {
      validator?: string;
      path?: string;
      code?: string;
      message?: string;
    };

    return {
      severity: 'error' as const,
      code: candidate.code ?? 'invalid',
      diagnostics: candidate.message ?? 'Validation error',
      field: candidate.path,
      validator: candidate.validator,
    };
  });
}

export interface FhirErrorResponseOptions {
  correlationId?: string;
  logger?: Logger;
  skipLog?: boolean;
}

/**
 * Maps {@link FhirValidationError} to a FHIR OperationOutcome HTTP response.
 */
export function fhirValidationErrorResponse(
  error: FhirValidationError | FhirValidationErrorLike,
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

  const outcome = buildOperationOutcome(
    normalizeValidationIssues(error.issues),
    error.resourceType,
  );

  return {
    statusCode: error.statusCode,
    headers: {
      'Content-Type': 'application/fhir+json',
    },
    body: JSON.stringify(outcome),
  };
}

export { FhirValidationError };
