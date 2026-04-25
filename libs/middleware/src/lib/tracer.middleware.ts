import { getLoggerContext } from '@api-hub/observability';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Segment, Subsegment } from 'aws-xray-sdk-core';

import type { Middleware, MiddlewareParams, MiddlewarePipelineEvent } from './types';

/**
 * @see `captureResponse` in Powertools middy — API Gateway responses are often large; default `false`.
 */
export type TracerMiddlewareOptions = {
  captureResponse?: boolean;
  subsegmentName?: string;
  /** Operation for X-Ray annotations (e.g. `template.get`). */
  operation?: string;
};

function snapshotEventForTrace(value: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) {
            return '[Circular]';
          }
          seen.add(v);
        }
        return v;
      }) as string
    ) as unknown;
  } catch {
    return { _error: 'event_not_serializable_for_trace' };
  }
}

/**
 * AWS Lambda Powertools Tracer: opens a subsegment for the **remainder of the chain** (schema,
 * performance, business handler) so work and downstream calls run under one X-Ray subsegment.
 * Puts `correlationId` from `event.__context` on the segment.
 *
 * Run **after** context, invocation-context, and logger middleware so `event.__context` and AsyncLocalStorage are set.
 */
export function tracerMiddleware<
  TResult = unknown,
  TContext = unknown,
>(
  tracer: Tracer,
  options?: TracerMiddlewareOptions,
): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async (params: MiddlewareParams<MiddlewarePipelineEvent, TResult, TContext>) => {
    const { event, next } = params;

    if (!tracer.isTracingEnabled()) {
      return next();
    }

    const facadeSegment = tracer.getSegment() as Segment | Subsegment | undefined;
    if (facadeSegment === undefined) {
      return next();
    }

    const ctxEvent = (event as MiddlewarePipelineEvent).__context;
    const als = getLoggerContext();
    const op =
      options?.operation ??
      (typeof ctxEvent?.operation === 'string' && ctxEvent.operation.length > 0
        ? ctxEvent.operation
        : undefined) ??
      (typeof als.operation === 'string' && als.operation.length > 0
        ? als.operation
        : undefined);
    const name =
      options?.subsegmentName ??
      (typeof op === 'string' && op.length > 0 ? `## ${op}` : `## ${process.env._HANDLER ?? 'handler'}`);
    const handlerSubsegment = facadeSegment.addNewSubsegment(name);
    const lambdaFacade = facadeSegment;

    tracer.setSegment(handlerSubsegment);

    try {
      tracer.annotateColdStart();
      tracer.addServiceNameAnnotation();
      const c = (event as MiddlewarePipelineEvent).__context;
      const correlationId =
        (typeof als.correlationId === 'string' && als.correlationId.length > 0
          ? als.correlationId
          : typeof c?.correlationId === 'string'
            ? c.correlationId
            : undefined) as string | undefined;
      if (typeof correlationId === 'string' && correlationId.length > 0) {
        tracer.putAnnotation('correlationId', correlationId);
      }
      if (typeof op === 'string' && op.length > 0) {
        tracer.putAnnotation('operation', op);
      }
      tracer.putMetadata('event', snapshotEventForTrace(event), 'event');
    } catch {
      /* annotations are best-effort */
    }

    try {
      const result = await next();
      if (tracer.isTracingEnabled() && options?.captureResponse === true) {
        tracer.addResponseAsMetadata(result, process.env._HANDLER);
      }
      return result;
    } catch (err) {
      if (tracer.isTracingEnabled()) {
        tracer.addErrorAsMetadata(err as Error);
      }
      throw err;
    } finally {
      if (tracer.isTracingEnabled()) {
        try {
          handlerSubsegment.close();
        } catch (closeErr) {
          console.warn('Failed to close X-Ray subsegment; trace data may be incomplete.', closeErr);
        }
        tracer.setSegment(lambdaFacade);
      }
    }
  };
}
