import { APIGatewayProxyResult } from 'aws-lambda';

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal };

/**
 * Structured message object for error responses
 */
export interface MessageObject {
  title: string;
  description: string;
  severity: 'error' | 'info' | 'warning';
}

/**
 * Standard JSON API Response Format
 * Reference: https://medium.com/@bojanmajed/standard-json-api-response-format-c6c1aabcaa6d
 *
 * Success Response Structure:
 * {
 *   "status": true,
 *   "message": "Operation successful",
 *   "data": { ... }
 * }
 *
 * Error Response Structure:
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Error Title",
 *     "description": "Error description",
 *     "severity": "error"
 *   },
 *   "errors": [ ... ]
 * }
 */
export interface JsonApiResponse<T = unknown> {
  status: boolean;
  message: string | MessageObject;
  data?: T | null;
  errors?: Array<{
    code?: string;
    field?: string;
    message: string;
    detail?: string;
  }>;
  meta?: Record<string, JsonVal>;
  links?: Record<string, string>;
  requestId?: string;
  correlationId?: string;
}

/**
 * Common response options for success responses
 */
export interface SuccessResponseOptions {
  meta?: Record<string, JsonVal>;
  links?: Record<string, string>;
  requestId?: string;
  message?: string;
}

/**
 * Error detail structure
 */
export interface ErrorDetail {
  code?: string;
  field?: string;
  message: string;
  detail?: string;
}

/**
 * Common error response options
 */
export interface ErrorResponseOptions {
  code?: string;
  correlationId?: string;
  errors?: Array<ErrorDetail>;
  meta?: Record<string, JsonVal>;
}

/**
 * Creates CORS headers for API Gateway responses
 */
function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Correlation-Id,X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
  };
}

/**
 * Creates a standard HTTP response object with CORS headers
 */
function createResponse(
  statusCode: number,
  body: unknown,
  contentType = 'application/json',
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': contentType,
      ...getCorsHeaders(),
    },
    body: JSON.stringify(body),
  };
}

/**
 * Creates a standard success response body in JSON API format
 */
function createSuccessBody<T>(
  data: T | null,
  message: string,
  options?: SuccessResponseOptions,
): JsonApiResponse<T> {
  const body: JsonApiResponse<T> = {
    status: true,
    message: message || 'Operation successful',
    data: data ?? null,
  };

  if (options?.meta) {
    body.meta = options.meta;
  }
  if (options?.links) {
    body.links = options.links;
  }
  if (options?.requestId) {
    body.requestId = options.requestId;
  }

  return body;
}

/**
 * Creates a standard error response body in JSON API format
 */
function createErrorBody(
  message: string | MessageObject,
  errors: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): JsonApiResponse {
  const body: JsonApiResponse = {
    status: false,
    message,
    errors,
  };

  if (options?.correlationId) {
    body.correlationId = options.correlationId;
  }
  if (options?.meta) {
    body.meta = options.meta;
  }

  return body;
}

// ============================================================================
// SUCCESS RESPONSE HELPERS
// ============================================================================

/**
 * Returns a 200 OK response with data
 */
export function ok<T>(
  data: T | null,
  message = 'Operation successful',
  options?: SuccessResponseOptions,
): APIGatewayProxyResult {
  return createResponse(200, createSuccessBody(data, message, options));
}

/**
 * Returns a 201 Created response with the created resource
 */
export function created<T>(
  data: T | null,
  message = 'Resource created successfully',
  options?: SuccessResponseOptions,
): APIGatewayProxyResult {
  return createResponse(201, createSuccessBody(data, message, options));
}

/**
 * Returns a 202 Accepted response (async operation accepted)
 */
export function accepted<T>(
  data: T | null,
  message = 'Request accepted for processing',
  options?: SuccessResponseOptions,
): APIGatewayProxyResult {
  return createResponse(202, createSuccessBody(data, message, options));
}

/**
 * Returns a 204 No Content response (successful operation with no response body)
 */
export function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: {},
    body: '',
  };
}

// ============================================================================
// ERROR RESPONSE HELPERS (JSON API Format)
// ============================================================================

/**
 * Generic error response in JSON API format
 * Use this for custom error scenarios
 */
export function error(
  statusCode: number,
  message: string | MessageObject,
  errors: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const messageObj: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  return createResponse(statusCode, createErrorBody(messageObj, errors, options));
}

/**
 * Returns a 400 Bad Request response
 */
export function badRequest(
  message: string | MessageObject,
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const messageObj: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'BAD_REQUEST',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(400, messageObj, errorDetails, options);
}

/**
 * Returns a 401 Unauthorized response
 */
export function unauthorized(
  message: string | MessageObject = 'Unauthorized',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'UNAUTHORIZED',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(401, defaultMessage, errorDetails, options);
}

/**
 * Returns a 403 Forbidden response
 */
export function forbidden(
  message: string | MessageObject = 'Forbidden',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'FORBIDDEN',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(403, defaultMessage, errorDetails, options);
}

/**
 * Returns a 404 Not Found response
 */
export function notFound(
  message: string | MessageObject,
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const messageObj: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'NOT_FOUND',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(404, messageObj, errorDetails, options);
}

/**
 * Returns a 409 Conflict response (e.g., resource already exists)
 */
export function conflict(
  message: string | MessageObject,
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const messageObj: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'CONFLICT',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(409, messageObj, errorDetails, options);
}

/**
 * Returns a 422 Unprocessable Entity response (validation errors)
 */
export function unprocessableEntity(
  message: string | MessageObject,
  errors: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const messageObj: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  return error(422, messageObj, errors, options);
}

/**
 * Returns a 429 Too Many Requests response (rate limiting)
 */
export function tooManyRequests(
  message: string | MessageObject = 'Too Many Requests',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'RATE_LIMIT_EXCEEDED',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(429, defaultMessage, errorDetails, options);
}

/**
 * Returns a 500 Internal Server Error response
 */
export function internalServerError(
  message: string | MessageObject = 'Internal Server Error',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'INTERNAL_ERROR',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(500, defaultMessage, errorDetails, options);
}

/**
 * Returns a 502 Bad Gateway response (upstream service error)
 */
export function badGateway(
  message: string | MessageObject = 'Bad Gateway',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'BAD_GATEWAY',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(502, defaultMessage, errorDetails, options);
}

/**
 * Returns a 503 Service Unavailable response
 */
export function serviceUnavailable(
  message: string | MessageObject = 'Service Unavailable',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'SERVICE_UNAVAILABLE',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(503, defaultMessage, errorDetails, options);
}

/**
 * Returns a 504 Gateway Timeout response
 */
export function gatewayTimeout(
  message: string | MessageObject = 'Gateway Timeout',
  errors?: Array<ErrorDetail>,
  options?: ErrorResponseOptions,
): APIGatewayProxyResult {
  const defaultMessage: MessageObject =
    typeof message === 'string'
      ? { title: message, description: message, severity: 'error' }
      : message;
  const errorDetails: Array<ErrorDetail> =
    errors ||
    [
      {
        code: options?.code || 'GATEWAY_TIMEOUT',
        message: typeof message === 'string' ? message : message.title,
      },
    ];
  return error(504, defaultMessage, errorDetails, options);
}
