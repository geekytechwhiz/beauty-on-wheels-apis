import type { APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/utils';

import {
  fhirValidationErrorResponse as mapFhirValidationErrorResponse,
  FhirValidationError,
  isFhirEnabled,
  isFhirRequest,
  isFhirValidationErrorLike,
  shouldTransformFhirRequest,
  transformFhirRequest,
  transformToFhirResponse,
  type FhirHandlerOptions,
} from '@api-hub/fhir/middleware';

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
  isFhirValidationErrorLike,
  isFhirRequest,
  shouldTransformFhirRequest,
  transformFhirRequest,
};
