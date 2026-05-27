import type { Tracer } from '@aws-lambda-powertools/tracer';
 
export async function traceRealtimeAsync(
  tracer: Tracer,
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  if (!tracer.isTracingEnabled()) {
    await fn();
    return;
  }

  const facadeSegment = tracer.getSegment();
  if (facadeSegment === undefined) {
    await fn();
    return;
  }

  const subsegment = facadeSegment.addNewSubsegment(`## ${name}`);
  tracer.setSegment(subsegment);

  try {
    await fn();
  } finally {
    try {
      subsegment.close();
    } catch {
      /* subsegment close is best-effort */
    }
    tracer.setSegment(facadeSegment);
  }
}
