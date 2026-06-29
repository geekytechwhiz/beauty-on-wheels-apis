import { ApiResponse, type LambdaRequest, type Message } from '@api-hub/utils';
import type { APIGatewayProxyResult } from 'aws-lambda';

import { TEMPLATE_API_MESSAGES } from './template-api-messages';

const DEFAULT_SUCCESS: Message = {
  title: 'SUCCESS',
  description: 'Request completed successfully.',
  severity: 'SUCCESS',
};

export function templateCorrelationId(req: LambdaRequest): string {
  return (req.context as { correlationId?: string }).correlationId ?? 'unknown';
}

export function templateOk(
  req: LambdaRequest,
  data: unknown,
  message: Message,
): APIGatewayProxyResult {
  return ApiResponse.ok(data, message, { correlationId: templateCorrelationId(req) });
}

export function templateCreated(
  req: LambdaRequest,
  data: unknown,
  message: Message,
): APIGatewayProxyResult {
  return ApiResponse.created(data, message, { correlationId: templateCorrelationId(req) });
}

export function templateOperationMessage(operation: string): Message {
  return TEMPLATE_API_MESSAGES[operation] ?? DEFAULT_SUCCESS;
}
