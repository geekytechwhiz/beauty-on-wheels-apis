import type { APIGatewayProxyevent: any, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
  type Logger,
} from '@api-hub/observability';
import { PartnerRepository } from '../repositories/partner.repository';
import { PartnerService } from '../services/partner.service';

export const baseLogger = createLogger({ service: 'partner-registry', redactPII: true });

const repository = new PartnerRepository();
const partnerService = new PartnerService(repository);

export function getPartnerService(): PartnerService {
  return partnerService;
}

export function getRequestId(event: APIGatewayProxyevent: any, context?: Context): string {
  return extractCorrelationId(event) || (context && extractAwsRequestId(context)) || 'unknown';
}

export function responseOpts(event: APIGatewayProxyevent: any, requestId: string) {
  return { requestId, event };
}

export function createHandlerLogger(
  event: APIGatewayProxyevent: any,
  context?: Context,
  meta?: Record<string, unknown>
): Logger {
  const requestId = getRequestId(event: any, context);
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
