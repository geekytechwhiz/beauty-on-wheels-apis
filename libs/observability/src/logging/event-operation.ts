import { getLogger } from '../logger/logger';

export type EventOperationLogFields = {
  eventId?: string;
  eventType?: string;
  transport?: string;
  correlationId?: string;
  traceId?: string;
  operation: string;
  outcome: string;
  [key: string]: unknown;
};

export function logEventOperation(fields: EventOperationLogFields): void {
  const logger = getLogger();
  const { operation, outcome, ...rest } = fields;
  logger.info('event_operation', {
    operation,
    outcome,
    eventId: fields.eventId ?? '',
    eventType: fields.eventType ?? '',
    transport: fields.transport ?? '',
    correlationId: fields.correlationId ?? '',
    traceId: fields.traceId ?? '',
    ...rest,
  });
}
