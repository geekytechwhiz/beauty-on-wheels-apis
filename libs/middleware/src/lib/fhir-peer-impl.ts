 
import type { APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/utils';

import {
  fhirValidationErrorResponse as mapFhirValidationErrorResponse,
  FhirValidationError,
} from './fhir/fhir-error-response';
import { isFhirRequest } from './fhir/is-fhir-request';
import {
  shouldTransformFhirRequest,
  transformFhirRequest,
} from './fhir/transform-fhir-request';
import {
  isFhirEnabled,
  transformToFhirResponse,
  type FhirHandlerOptions,
} from './fhir/transform-to-fhir-response';

import type { FhirPeerModule } from './fhir-peer';

export type ApiHubFhirPeerModule = FhirPeerModule & {
  isFhirRequest: (req: LambdaRequest) => boolean;
  shouldTransformFhirRequest: (
    req: LambdaRequest,
    options: FhirHandlerOptions,
    fhirRequested: boolean,
  ) => boolean;
  transformFhirRequest: (
    req: LambdaRequest,
    options: FhirHandlerOptions,
  ) => Promise<void>;
};

export const apiHubFhirPeer: ApiHubFhirPeerModule = {
  isFhirEnabled,
  transformToFhirResponse,
  fhirValidationErrorResponse: (
    error: unknown,
    options?: {
      correlationId?: string;
      logger?: unknown;
      skipLog?: boolean;
    },
  ): APIGatewayProxyResult => {
    if (error instanceof FhirValidationError) {
      return mapFhirValidationErrorResponse(error, {
        correlationId: options?.correlationId,
        logger: options?.logger as Parameters<
          typeof mapFhirValidationErrorResponse
        >[1]['logger'],
        skipLog: options?.skipLog,
      });
    }

    throw error;
  },
  FhirValidationError,
  isFhirValidationErrorLike: (error: unknown) => {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const candidate = error as Record<string, unknown>;
    return (
      candidate.code === 'FHIR_VALIDATION_FAILED' &&
      Array.isArray(candidate.issues) &&
      typeof candidate.statusCode === 'number'
    );
  },
  isFhirRequest,
  shouldTransformFhirRequest,
  transformFhirRequest,
};
