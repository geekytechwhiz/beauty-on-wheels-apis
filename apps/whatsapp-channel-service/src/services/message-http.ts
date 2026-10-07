import { APIGatewayProxyResult } from 'aws-lambda';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { ApiResponse, ErrorBody } from '@api-hub/utils';
import { ChannelError, CHANNEL_ERROR_CODE, isChannelError } from '../errors/channel-error';
import { HttpRequest, HttpResponse } from './webhook-http';
import { WhatsAppMessageService } from './whatsapp-message.service';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'whatsapp-messages-http',
});

const SEND_FAILED_MESSAGE = 'Failed to send WhatsApp message';

export function isSendMessageRequest(request: Pick<HttpRequest, 'method' | 'path'>): boolean {
  return request.method === 'POST' && request.path.endsWith('/whatsapp/messages');
}

export async function handleSendMessageRequest(
  request: HttpRequest,
  serviceFactory: () => Promise<Pick<WhatsAppMessageService, 'sendText'>>,
): Promise<HttpResponse> {
  const correlationId = header(request.headers, 'x-correlation-id') || `corr-${Date.now()}`;
  logger.info({
    event: 'whatsapp_send_request_received',
    correlationId,
    method: request.method,
    path: request.path,
  });

  try {
    const command = readCommand(request.rawBody);
    const service = await serviceFactory();
    const result = await service.sendText(command);
    return fromApi(ApiResponse.ok(
      { messageId: result.messageId, to: result.to },
      { title: 'Sent', description: 'WhatsApp message sent', severity: 'SUCCESS' },
      { correlationId },
    ));
  } catch (error) {
    const channel = normalizeError(error);
    logger.error({ event: 'whatsapp_send_failed', correlationId, code: channel.code });
    return fromApi(toErrorResponse(channel, correlationId));
  }
}

function readCommand(rawBody: string): { to?: unknown; message?: unknown } {
  if (!rawBody.trim()) {
    throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Request body is required', {
      metadata: { field: 'body' },
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Request body must be JSON', {
      metadata: { field: 'body' },
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, 'Request body must be a JSON object', {
      metadata: { field: 'body' },
    });
  }
  const record = parsed as Record<string, unknown>;
  return { to: record.to, message: record.message };
}

function normalizeError(error: unknown): ChannelError {
  if (isChannelError(error)) return error;
  const text = error instanceof Error ? error.message : '';
  if (/WHATSAPP_(ACCESS_TOKEN|PHONE_NUMBER_ID|API_VERSION|SECRET_NAME)|missing required fields/i.test(text)) {
    return new ChannelError(CHANNEL_ERROR_CODE.WHATSAPP_CONFIG_MISSING, 'WhatsApp configuration is incomplete');
  }
  logger.error({ event: 'whatsapp_send_unexpected', errorName: error instanceof Error ? error.name : 'Error' });
  return new ChannelError(CHANNEL_ERROR_CODE.WHATSAPP_SEND_FAILED, SEND_FAILED_MESSAGE);
}

function toErrorResponse(error: ChannelError, correlationId: string): APIGatewayProxyResult {
  const field = typeof error.metadata?.field === 'string' ? error.metadata.field : undefined;
  const mapped = publicError(error);
  const message = { title: 'Error', description: mapped.message, severity: 'ERROR' as const };
  const body = errorBody(mapped.code, mapped.message, field);
  const options = { correlationId };
  if (mapped.statusCode === 400) return ApiResponse.badRequest(message, options, body);
  if (mapped.statusCode === 401) return ApiResponse.unauthorized(message, options, body);
  if (mapped.statusCode === 403) return ApiResponse.forbidden(message, options, body);
  if (mapped.statusCode === 500) return ApiResponse.internalServerError(message, options, body);
  return ApiResponse.error(mapped.statusCode, message, options, body);
}

function publicError(error: ChannelError): { statusCode: number; code: string; message: string } {
  switch (error.code) {
    case CHANNEL_ERROR_CODE.VALIDATION_ERROR:
      return { statusCode: 400, code: CHANNEL_ERROR_CODE.VALIDATION_ERROR, message: error.message };
    case CHANNEL_ERROR_CODE.WHATSAPP_CONFIG_MISSING:
      return { statusCode: 500, code: CHANNEL_ERROR_CODE.WHATSAPP_CONFIG_MISSING, message: error.message };
    case CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR:
      return { statusCode: 401, code: 'WHATSAPP_AUTH_FAILED', message: SEND_FAILED_MESSAGE };
    case CHANNEL_ERROR_CODE.AUTHORIZATION_ERROR:
      return { statusCode: 403, code: 'WHATSAPP_AUTH_FAILED', message: SEND_FAILED_MESSAGE };
    case CHANNEL_ERROR_CODE.TIMEOUT:
      return { statusCode: 504, code: 'WHATSAPP_SEND_FAILED', message: SEND_FAILED_MESSAGE };
    default:
      return { statusCode: error.statusCode >= 400 ? error.statusCode : 502, code: 'WHATSAPP_SEND_FAILED', message: SEND_FAILED_MESSAGE };
  }
}

function errorBody(code: string, text: string, field?: string): ErrorBody {
  const body: ErrorBody & { message: string } = {
    code,
    message: text,
    details: [field ? { field, message: text } : { message: text }],
  };
  return body;
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function fromApi(response: APIGatewayProxyResult): HttpResponse {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    if (value !== undefined && value !== false) headers[key] = String(value);
  }
  return { statusCode: response.statusCode, body: response.body, headers };
}
