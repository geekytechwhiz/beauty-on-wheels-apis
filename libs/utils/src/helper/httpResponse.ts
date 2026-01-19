import { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import { getMessage, getErrorMessage, type ResolvedMessage } from './messageResolver';

export type UnifiedSeverity = 'SUCCESS' | 'INFO' | 'WARNING' | 'ERROR';

export interface UnifiedMessage {
  title: string;
  description: string;
  severity: UnifiedSeverity;
}

export interface UnifiedMeta {
  requestId: string;
  timestamp: string;
  version: 'v1';
}

export interface UnifiedErrorDetail {
  code?: string;
  field?: string;
  message: string;
  detail?: string;
}

export interface UnifiedError {
  code?: string;
  details?: UnifiedErrorDetail[];
}

export interface UnifiedResponseBody<T = unknown> {
  success: boolean;
  statusCode: number;
  message: UnifiedMessage;
  data: T | null;
  error: UnifiedError | null;
  meta: UnifiedMeta;
}

export interface UnifiedResponseOptions {
  requestId: string;
  version?: 'v1';
  headers?: Record<string, string>;
  event?: APIGatewayProxyEvent; // Optional: for CDN message fetching
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Correlation-Id,X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
  };
}

function toIsoNow() {
  return new Date().toISOString();
}

function createResponse<T>(
  statusCode: number,
  body: UnifiedResponseBody<T>,
  extraHeaders?: Record<string, string>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(),
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(body),
  };
}

function buildMeta(options: UnifiedResponseOptions): UnifiedMeta {
  return {
    requestId: options.requestId,
    timestamp: toIsoNow(),
    version: options.version ?? 'v1',
  };
}

/**
 * Resolves a message from either:
 * 1. A message object directly
 * 2. A message key string (fetches from CDN using event)
 */
async function resolveMessageInput(
  messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
  options: UnifiedResponseOptions,
  isError: boolean,
): Promise<Omit<UnifiedMessage, 'severity'>> {
  // If it's already a message object, return it
  if (typeof messageOrKey === 'object') {
    return messageOrKey;
  }

  // It's a string key - fetch from CDN
  if (!options.event) {
    console.warn(`Message key "${messageOrKey}" provided but no event in options. Using defaults.`);
    return {
      title: isError ? 'Error' : 'Success',
      description: isError ? 'An error occurred' : 'Request processed successfully',
    };
  }

  const resolved: ResolvedMessage = isError
    ? await getErrorMessage(options.event, messageOrKey)
    : await getMessage(options.event, messageOrKey);

  return {
    title: resolved.title,
    description: resolved.description,
  };
}

export class ApiResponse {
  /**
   * Returns a 200 OK response
   * @param data - Response data
   * @param messageOrKey - Either a message object OR a message key string (requires options.event)
   * @param options - Response options (must include event if messageOrKey is a string)
   */
  static async ok<T>(
    data: T | null,
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, false);
    return createResponse(
      200,
      {
        success: true,
        statusCode: 200,
        message: { ...message, severity: 'SUCCESS' },
        data: data ?? null,
        error: null,
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 201 Created response
   */
  static async created<T>(
    data: T | null,
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, false);
    return createResponse(
      201,
      {
        success: true,
        statusCode: 201,
        message: { ...message, severity: 'SUCCESS' },
        data: data ?? null,
        error: null,
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 202 Accepted response
   */
  static async accepted<T>(
    data: T | null,
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, false);
    return createResponse(
      202,
      {
        success: true,
        statusCode: 202,
        message: { ...message, severity: 'SUCCESS' },
        data: data ?? null,
        error: null,
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 400 Bad Request response
   */
  static async badRequest(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      400,
      {
        success: false,
        statusCode: 400,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'BAD_REQUEST' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 401 Unauthorized response
   */
  static async unauthorized(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      401,
      {
        success: false,
        statusCode: 401,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'UNAUTHORIZED' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 403 Forbidden response
   */
  static async forbidden(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      403,
      {
        success: false,
        statusCode: 403,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'FORBIDDEN' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 404 Not Found response
   */
  static async notFound(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      404,
      {
        success: false,
        statusCode: 404,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'NOT_FOUND' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 409 Conflict response
   */
  static async conflict(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      409,
      {
        success: false,
        statusCode: 409,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'CONFLICT' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 422 Unprocessable Entity response
   */
  static async unprocessableEntity(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      422,
      {
        success: false,
        statusCode: 422,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'UNPROCESSABLE_ENTITY' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 429 Too Many Requests response
   */
  static async tooManyRequests(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      429,
      {
        success: false,
        statusCode: 429,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'RATE_LIMIT_EXCEEDED' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a 500 Internal Server Error response
   */
  static async internalServerError(
    messageOrKey: Omit<UnifiedMessage, 'severity'> | string,
    options: UnifiedResponseOptions,
    error?: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    const message = await resolveMessageInput(messageOrKey, options, true);
    return createResponse(
      500,
      {
        success: false,
        statusCode: 500,
        message: { ...message, severity: 'ERROR' },
        data: null,
        error: error ?? { code: 'INTERNAL_ERROR' },
        meta: buildMeta(options),
      },
      options.headers,
    );
  }

  /**
   * Returns a custom error response
   */
  static async error(
    statusCode: number,
    messageOrKey: UnifiedMessage | string,
    options: UnifiedResponseOptions,
    error: UnifiedError,
  ): Promise<APIGatewayProxyResult> {
    let message: UnifiedMessage;
    
    if (typeof messageOrKey === 'string') {
      const resolved = await resolveMessageInput(messageOrKey, options, true);
      message = { ...resolved, severity: 'ERROR' };
    } else {
      message = messageOrKey;
    }

    return createResponse(
      statusCode,
      {
        success: false,
        statusCode,
        message,
        data: null,
        error,
        meta: buildMeta(options),
      },
      options.headers,
    );
  }
}
