/* eslint-disable @nx/enforce-module-boundaries */
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
} from '@api-hub/fhir';

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
        logger: options?.logger  ,
        skipLog: options?.skipLog,
      });
    }

    throw error;
  },
  FhirValidationError: FhirValidationError as unknown as new (...args: any[]) => Error,
  isFhirValidationErrorLike,
  isFhirRequest,
  shouldTransformFhirRequest,
  transformFhirRequest,
};
