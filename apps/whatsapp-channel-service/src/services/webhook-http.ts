import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { extractCorrelationId } from '@api-hub/observability';
import { CHANNEL_ERROR_CODE } from '../errors/channel-error';
import { recordMetric, WHATSAPP_METRIC } from '../infra/metrics';
import { InboundEnvelope, WhatsAppWebhookPayload } from '../types/whatsapp';

export interface HttpRequest {
  method: string;
  path: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
}

export interface HttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export interface WebhookRuntime {
  verifyWebhook(mode?: string, token?: string, challenge?: string): string | null;
  verifySignature(rawBody: string, signatureHeader?: string): boolean;
  processInline: boolean;
  processWebhook(payload: WhatsAppWebhookPayload, correlationId: string): Promise<void>;
  enqueue(envelope: InboundEnvelope): Promise<void>;
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function message(title: string, description: string, severity: 'INFO' | 'ERROR' = 'INFO') {
  return { title, description, severity };
}

function asHeaders(headers: APIGatewayProxyResult['headers']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value !== undefined && value !== false) result[key] = String(value);
  }
  return result;
}

export async function handleHttpRequest(request: HttpRequest, runtime: WebhookRuntime): Promise<HttpResponse> {
  const correlationId = header(request.headers, 'x-correlation-id') || `corr-${Date.now()}`;
  const options = { correlationId };

  try {
    if (request.method === 'GET' && request.path.endsWith('/health')) {
      const response = ApiResponse.ok({ status: 'ok', service: 'whatsapp-channel-service' }, 'OK', options);
      return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
    }

    if (request.method === 'GET' && request.path.includes('/webhooks/whatsapp')) {
      const challenge = runtime.verifyWebhook(request.query['hub.mode'], request.query['hub.verify_token'], request.query['hub.challenge']);
      if (!challenge) {
        const response = ApiResponse.forbidden(message('Forbidden', 'Webhook verification failed'), options, { code: CHANNEL_ERROR_CODE.AUTHORIZATION_ERROR });
        return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
      }
      return { statusCode: 200, body: challenge, headers: { 'Content-Type': 'text/plain' } };
    }

    if (request.method === 'POST' && request.path.includes('/webhooks/whatsapp')) {
      const signature = header(request.headers, 'x-hub-signature-256');
      if (!runtime.verifySignature(request.rawBody, signature)) {
        recordMetric(WHATSAPP_METRIC.WEBHOOK_FAILED);
        const response = ApiResponse.unauthorized(message('Unauthorized', 'Invalid webhook signature'), options, { code: CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR });
        return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
      }

      let payload: WhatsAppWebhookPayload;
      try {
        payload = JSON.parse(request.rawBody) as WhatsAppWebhookPayload;
      } catch {
        const response = ApiResponse.badRequest(message('Bad Request', 'Webhook body must be JSON'), options, { code: CHANNEL_ERROR_CODE.VALIDATION_ERROR });
        return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
      }

      if (payload.object && payload.object !== 'whatsapp_business_account') {
        const response = ApiResponse.ok({ received: true, ignored: true }, 'Ignored', options);
        return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
      }

      if (runtime.processInline || !runtime.enqueue) {
        await runtime.processWebhook(payload, correlationId);
      } else {
        await runtime.enqueue({ correlationId, receivedAt: new Date().toISOString(), payload });
      }

      const response = ApiResponse.ok({ received: true }, 'Received', options);
      return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
    }

    const response = ApiResponse.notFound(message('Not Found', 'Route not found'), options, { code: CHANNEL_ERROR_CODE.NOT_FOUND });
    return { statusCode: response.statusCode, body: response.body, headers: asHeaders(response.headers) };
  } catch {
    recordMetric(WHATSAPP_METRIC.WEBHOOK_FAILED);
    const response = ApiResponse.badRequest(
      message('Error', 'Webhook processing failed'),
      options,
      { code: CHANNEL_ERROR_CODE.INTERNAL_ERROR },
    );
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        statusCode: 500,
        message: { title: 'Error', description: 'Webhook processing failed', severity: 'ERROR' },
        data: null,
        error: { code: CHANNEL_ERROR_CODE.INTERNAL_ERROR },
        meta: { correlationId, timestamp: new Date().toISOString(), version: 'v1' },
      }),
      headers: { 'Content-Type': 'application/json', ...asHeaders(response.headers) },
    };
  }
}

export function fromApiGatewayEvent(event: APIGatewayProxyEvent): HttpRequest {
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key, value ?? undefined]));
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body ?? '';
  return {
    method: event.httpMethod.toUpperCase(),
    path: event.path,
    rawBody,
    headers: { ...headers, 'x-correlation-id': extractCorrelationId(event) },
    query: event.queryStringParameters ?? {},
  };
}
