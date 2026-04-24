import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Segment, Subsegment } from 'aws-xray-sdk-core';

import type { Middleware, MiddlewareParams, MiddlewarePipelineEvent } from './types';

/**
 * @see `captureResponse` in Powertools middy — API Gateway responses are often large; default `false`.
 */
export type TracerMiddlewareOptions = {
  captureResponse?: boolean;
  subsegmentName?: string;
};

/**
 * AWS Lambda Powertools Tracer: opens a subsegment for the **remainder of the chain** (schema,
 * performance, business handler) so work and downstream calls run under one X-Ray subsegment.
 * Puts `correlationId` from `event.__context` on the segment.
 *
 * Run **after** {@link contextMiddleware} (and {@link loggerMiddleware}) so `event.__context` is set.
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

    const name = options?.subsegmentName ?? `## ${process.env._HANDLER ?? 'handler'}`;
    const handlerSubsegment = facadeSegment.addNewSubsegment(name);
    const lambdaFacade = facadeSegment;

    tracer.setSegment(handlerSubsegment);

    try {
      tracer.annotateColdStart();
      tracer.addServiceNameAnnotation();
      const c = (event as MiddlewarePipelineEvent).__context;
      const correlationId = c?.correlationId;
      if (typeof correlationId === 'string' && correlationId.length > 0) {
        tracer.putAnnotation('correlationId', correlationId);
      }
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
