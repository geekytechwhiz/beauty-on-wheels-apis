import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
  type Logger,
} from '@api-hub/logger';
import { PartnerRepository } from '../repositories/partner.repository';
import { PartnerService } from '../services/partner.service';

export const baseLogger = createLogger({ service: 'partner-registry', redactPII: true });

const repository = new PartnerRepository();
const partnerService = new PartnerService(repository);

export function getPartnerService(): PartnerService {
  return partnerService;
}

export function getRequestId(event: APIGatewayProxyEvent, context?: Context): string {
  return extractCorrelationId(event) || (context && extractAwsRequestId(context)) || 'unknown';
}

export function responseOpts(event: APIGatewayProxyEvent, requestId: string) {
  return { requestId, event };
}

export function createHandlerLogger(
  event: APIGatewayProxyEvent,
  context?: Context,
  meta?: Record<string, unknown>
): Logger {
  const requestId = getRequestId(event, context);
  return createChildLogger(baseLogger, {
    correlationId: requestId,
    ...(context && { awsRequestId: extractAwsRequestId(context) }),
    ...meta,
  });
}

/**
 * Parses event.body as JSON. Returns null if invalid.
 */
export function parseJsonBody(event: APIGatewayProxyEvent): unknown | null {
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body ?? {};
  } catch {
    return null;
  }
}
