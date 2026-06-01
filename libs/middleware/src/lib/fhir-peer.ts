import type { APIGatewayProxyResult } from 'aws-lambda';
import type { LambdaRequest } from '@api-hub/utils';

/** Structural mirror of {@link FhirHandlerOptions} in @myvitalrx/platform-tools/fhir — no compile-time FHIR dep. */
export type FhirHandlerOptions = {
  enabled?: boolean;
  resourceType?: string;
  resource?: string;
  resources?: string[];
  version?: 'R4';
};

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
}

const FHIR_MODULE = '@myvitalrx/platform-tools/fhir/middleware';

let cachedPeer: FhirPeerModule | null | undefined;

/**
 * Lazy-loads FHIR middleware from @myvitalrx/platform-tools/fhir/middleware.
 */
export async function loadFhirPeer(): Promise<FhirPeerModule | null> {
  if (cachedPeer !== undefined) {
    return cachedPeer;
  }

  try {
    cachedPeer = (await import(
      /* webpackIgnore: true */
      FHIR_MODULE
    )) as FhirPeerModule;
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
