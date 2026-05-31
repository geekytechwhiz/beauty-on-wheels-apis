 
import type { APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/utils';

import type { FhirHandlerOptions } from './fhir/transform-to-fhir-response';

export interface FhirPeerModule {
  isFhirEnabled: (options?: FhirHandlerOptions) => boolean;
  transformToFhirResponse: (
    result: unknown,
    options: FhirHandlerOptions,
    req: LambdaRequest,
  ) => Promise<unknown | undefined>;
  fhirValidationErrorResponse: (
    error: unknown,
    options?: {
      correlationId?: string;
      logger?: unknown;
      skipLog?: boolean;
    },
  ) => APIGatewayProxyResult;
  FhirValidationError: new (...args: unknown[]) => Error;
  isFhirValidationErrorLike: (error: unknown) => boolean;
  isFhirRequest?: (req: LambdaRequest) => boolean;
  shouldTransformFhirRequest?: (
    req: LambdaRequest,
    options: FhirHandlerOptions,
    fhirRequested: boolean,
  ) => boolean;
  transformFhirRequest?: (
    req: LambdaRequest,
    options: FhirHandlerOptions,
  ) => Promise<void>;
}

const PLATFORM_FHIR_MODULE = '@myvitalrx/platform-tools/fhir/middleware';

let cachedPeer: FhirPeerModule | null | undefined;

/**
 * Lazy-loads FHIR middleware from @myvitalrx/platform-tools/fhir/middleware,
 * then the local api-hub implementation in this package.
 */
export async function loadFhirPeer(): Promise<FhirPeerModule | null> {
  if (cachedPeer !== undefined) {
    return cachedPeer;
  }

  try {
    cachedPeer = (await import(
      /* webpackIgnore: true */
      PLATFORM_FHIR_MODULE
    )) as FhirPeerModule;
    return cachedPeer;
  } catch {
    // platform-tools not installed — use local impl
  }

  try {
    const local = await import('./fhir-peer-impl');
    cachedPeer = local.apiHubFhirPeer;
  } catch {
    cachedPeer = null;
  }

  return cachedPeer;
}

/** Local duck-type check — avoids dynamic import on the non-FHIR error path. */
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
