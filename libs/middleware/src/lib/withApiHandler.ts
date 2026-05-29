import type { LambdaInvocationContext } from '@api-hub/observability';
import type { z } from 'zod';

import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
} from '@api-hub/observability';

import { runMiddlewares } from './middlewareEngine';
import { buildApiExecutionPipeline } from './http-pipeline';
import { buildRequestContext } from './request-context.middleware';
import type {
  Middleware,
  MiddlewarePipelineEvent,
  RequestBuildEvent,
} from './types';
import type { FhirHandlerOptions } from './fhir/transform-to-fhir-response';
import {
  isFhirEnabled,
  transformToFhirResponse,
} from './fhir/transform-to-fhir-response';
import { fhirSuccessResponse } from './fhir/fhir-success-response';
import { isFhirRequest } from './fhir/is-fhir-request';
import {
  isMutatingHttpMethod,
  shouldTransformFhirRequest,
  transformFhirRequest,
} from './fhir/transform-fhir-request';
import { successResponse } from './response.middleware';
import { LambdaRequest } from '@api-hub/utils';

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});
export type ApiHandler<TReq, TResult> = (
  req: TReq
) => Promise<TResult>;
type RequestValidator = (
  req: LambdaRequest

) => void | Promise<void>;
export type   withApiHandlerOptions = {
  operation: string;
  /** Validates the full Lambda/API Gateway `event` (runs in HTTP schema middleware). */
  schema?: z.ZodType<unknown>;
  /**
   * Validates `req.body` after {@link buildRequestContext} (typical for JSON HTTP APIs).
   * Runs after logger/correlation are attached to `req.context`.
   */
  bodySchema?: z.ZodType<unknown>;
  /**
   * Optional request-level validation (e.g. tenant resolution) after body parsing.
   */
  validator?:RequestValidator;
  /**
   * When set, enables FHIR projection for callers that negotiate FHIR via
   * {@link isFhirRequest}. Inbound POST/PUT/PATCH FHIR bodies are converted to
   * canonical before validation. GET responses include canonical `data` plus a
   * sibling `fhir` Bundle; mutating requests may return raw FHIR when negotiated.
   */
  fhir?: FhirHandlerOptions;
};

function awsRequestIdFromLambdaContext(lambdaContext: unknown): string {
  if (
    lambdaContext &&
    typeof lambdaContext === 'object' &&
    'awsRequestId' in lambdaContext
  ) {
    return extractAwsRequestId(lambdaContext as LambdaInvocationContext);
  }
  return 'unknown-request-id';
}

/**
 * Composes the standard HTTP middleware chain and returns a Lambda handler that builds
 * {@link buildRequestContext}, attaches a **child logger** (same as {@link withLambdaHandler}),
 * optionally validates the body, runs `validator`, then invokes `handler(req)`.
 *
 * `requestParserMiddleware` runs before this adapter so `event.body` is typically already parsed.
 */
export function withApiHandler<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: withApiHandlerOptions,
  handler: ApiHandler<
    ReturnType<typeof buildRequestContext>,
    TResult
  >,
) {
  const stack = buildApiExecutionPipeline<TResult, TContext>({
    operation: options.operation,
    schema: options.schema,
  }) as Array<Middleware<TEvent, TResult, TContext>>;

  const adaptedHandler = async (
    event: TEvent,
    lambdaContext: TContext,
  ): Promise<TResult> => {
    const pipelineEvent = event as MiddlewarePipelineEvent;
    const std = pipelineEvent.__context;

    const correlationId =
      std?.correlationId ?? awsRequestIdFromLambdaContext(lambdaContext);

    const awsRequestId =
      std?.awsRequestId ?? awsRequestIdFromLambdaContext(lambdaContext);

    const logger = createChildLogger(baseLogger, {
      correlationId,
      awsRequestId,
    });
  
    const req = buildRequestContext(event as unknown as RequestBuildEvent);
    const ctxFields: Record<string, unknown> = {
      ...(req.context as unknown as Record<string, unknown>),
      logger,
      correlationId,
      awsRequestId,
      traceId: std?.traceId,
      operation: std?.operation,
    };
    (req as unknown as { context: Record<string, unknown> }).context =
      ctxFields;

    const fhirRequested = isFhirRequest(req);
    const fhirEnabled = isFhirEnabled(options.fhir);

    if (fhirEnabled && options.fhir && shouldTransformFhirRequest(req, options.fhir, fhirRequested)) {
      await transformFhirRequest(req, options.fhir);
    }

    (req as unknown as { context: Record<string, unknown> }).context =
      Object.freeze({
        ...(req.context as unknown as Record<string, unknown>),
      });

    if (options.bodySchema !== undefined) {
      req.body = options.bodySchema.parse(req.body) as typeof req.body;
    }

    if (options.validator !== undefined) {
      await options.validator(req);
    }

    const handleHandler = async (req: ReturnType<typeof buildRequestContext>) => {
      return await handler(req);
    };
    const result = await handleHandler(req);

    const correlationIdFromContext =
      (req.context as { correlationId?: string }).correlationId ?? 'unknown';

    if (fhirRequested && fhirEnabled && options.fhir && result) {
      const fhirBundle = await transformToFhirResponse(
        result,
        options.fhir,
        req,
      );

      if (fhirBundle) {
        if (isMutatingHttpMethod(req)) {
          return fhirSuccessResponse(fhirBundle) as TResult;
        }

        return successResponse(result, undefined, {
          correlationId: correlationIdFromContext,
          fhir: fhirBundle,
        }) as TResult;
      }
    }

    return successResponse(result, undefined, {
      correlationId: correlationIdFromContext,
    }) as TResult;
  };

  return runMiddlewares(stack, adaptedHandler) 
}
