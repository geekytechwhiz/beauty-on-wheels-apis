import { randomUUID } from 'crypto';

export function normalizeContext(event: any, context: any) {
  // 1. Client header
  const headerId =
    event?.headers?.['x-correlation-id'] ||
    event?.headers?.['X-Correlation-Id'];

  // 2. SQS
  const sqsId =
    event?.Records?.[0]?.messageAttributes?.correlationId?.stringValue;

  // 3. EventBridge
  const eventBridgeId = event?.detail?.correlationId;

  const correlationId =
    headerId ||
    sqsId ||
    eventBridgeId ||
    context?.awsRequestId ||
    randomUUID();

  return {
    correlationId,
    awsRequestId: context?.awsRequestId,
    functionName: context?.functionName,
  };
}