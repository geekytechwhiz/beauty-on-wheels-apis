import { Tracer } from '@aws-lambda-powertools/tracer';

const cache = new Map<string, Tracer>();

/**
 * Reuses a {@link Tracer} per `serviceName` (Lambda container lifetime) for consistent
 * cold-start annotations. For X-Ray on AWS SDK v3, call
 * `getTracerForService('my-service').captureAWSv3Client(client)` when constructing shared clients
 * (not in request handlers) so downstream calls are traced.
 */
export function getTracerForService(serviceName: string): Tracer {
  let t = cache.get(serviceName);
  if (!t) {
    t = new Tracer({
      serviceName,
      captureHTTPsRequests: true,
    });
    cache.set(serviceName, t);
  }
  return t;
}
