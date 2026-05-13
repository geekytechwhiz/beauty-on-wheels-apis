import { DlqMessage } from '../typings/dlq.types';

export function buildDlqMessage(params: {
  event: any;
  error: unknown;
  retryCount?: number;
}): DlqMessage {
  const err = params.error instanceof Error ? params.error : new Error(String(params.error));

  return {
    originalEvent: params.event,
    error: {
      message: err.message,
      name: err.name,
      stack: err.stack,
    },
    metadata: {
      eventType: params.event?.eventType,
      eventVersion: params.event?.eventVersion,
      correlationId: params.event?.meta?.correlationId,
      retryCount: params.retryCount,
      timestamp: new Date().toISOString(),
    },
  };
}