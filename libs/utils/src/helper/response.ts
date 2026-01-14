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
 * Creates a standard HTTP response object
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

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/**
 * ERROR RESPONSE EXAMPLES (JSON API Format with MessageObject):
 *
 * // 400 Bad Request - Invalid input (using string - auto-converted to MessageObject)
 * return badRequest('Invalid request', [
 *   { code: 'BAD_REQUEST', message: 'Missing required field: email' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 400 Bad Request - Using MessageObject structure
 * return badRequest({
 *   title: 'File Deletion Failed',
 *   description: 'The file could not be deleted due to invalid permissions',
 *   severity: 'error'
 * }, [
 *   { code: 'FILE_DELETE_FAILED', message: 'Insufficient permissions to delete file' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 401 Unauthorized - Missing or invalid authentication
 * return unauthorized({
 *   title: 'Authentication Required',
 *   description: 'Please provide a valid authentication token',
 *   severity: 'error'
 * }, [
 *   { code: 'UNAUTHORIZED', message: 'Please provide a valid authentication token' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 403 Forbidden - Authenticated but not authorized
 * return forbidden({
 *   title: 'Access Denied',
 *   description: 'You do not have permission to access this resource',
 *   severity: 'error'
 * }, [
 *   { code: 'FORBIDDEN', message: 'You do not have permission to access this resource' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 404 Not Found - Resource doesn't exist
 * return notFound({
 *   title: 'User Not Found',
 *   description: `User with ID ${userId} does not exist`,
 *   severity: 'error'
 * }, [
 *   { code: 'USER_NOT_FOUND', message: `User with ID ${userId} does not exist` }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 409 Conflict - Resource already exists or state conflict
 * return conflict({
 *   title: 'User Already Exists',
 *   description: `User with email ${email} already exists`,
 *   severity: 'error'
 * }, [
 *   { code: 'USER_ALREADY_EXISTS', message: `User with email ${email} already exists` }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 422 Unprocessable Entity - Validation errors
 * return unprocessableEntity({
 *   title: 'Validation Failed',
 *   description: 'The request contains validation errors',
 *   severity: 'error'
 * }, [
 *   { field: 'email', message: 'Invalid email format', code: 'INVALID_EMAIL' },
 *   { field: 'age', message: 'Age must be a positive number', code: 'INVALID_AGE' },
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 429 Too Many Requests - Rate limiting
 * return tooManyRequests({
 *   title: 'Rate Limit Exceeded',
 *   description: 'You have exceeded the rate limit of 100 requests per minute',
 *   severity: 'warning'
 * }, [
 *   { code: 'RATE_LIMIT_EXCEEDED', message: 'You have exceeded the rate limit of 100 requests per minute' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 500 Internal Server Error - Unexpected server error
 * return internalServerError({
 *   title: 'Internal Server Error',
 *   description: 'An unexpected error occurred. Please try again later or contact support',
 *   severity: 'error'
 * }, [
 *   { code: 'INTERNAL_ERROR', message: 'Please try again later or contact support' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 502 Bad Gateway - Upstream service error
 * return badGateway({
 *   title: 'Upstream Service Unavailable',
 *   description: 'The payment service is currently unavailable',
 *   severity: 'error'
 * }, [
 *   { code: 'UPSTREAM_SERVICE_ERROR', message: 'The payment service is currently unavailable' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 503 Service Unavailable - Service temporarily down
 * return serviceUnavailable({
 *   title: 'Service Temporarily Unavailable',
 *   description: 'The service is undergoing maintenance. Please try again in 30 minutes',
 *   severity: 'info'
 * }, [
 *   { code: 'SERVICE_UNAVAILABLE', message: 'The service is undergoing maintenance. Please try again in 30 minutes' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // 504 Gateway Timeout - Upstream timeout
 * return gatewayTimeout({
 *   title: 'Request Timeout',
 *   description: 'The upstream service did not respond in time',
 *   severity: 'error'
 * }, [
 *   { code: 'GATEWAY_TIMEOUT', message: 'The upstream service did not respond in time' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * // Custom error using error() directly
 * return error(418, {
 *   title: 'Custom Business Logic Error',
 *   description: 'This is a custom error scenario',
 *   severity: 'error'
 * }, [
 *   { code: 'CUSTOM_ERROR', message: 'This is a custom error scenario' }
 * ], {
 *   correlationId: 'req-123',
 * });
 *
 * SUCCESS RESPONSE EXAMPLES (JSON API Format):
 *
 * // 200 OK - Standard success response
 * return ok(user, 'User retrieved successfully', {
 *   requestId: correlationId,
 * });
 *
 * // 200 OK - With pagination metadata
 * return ok(users, 'Users retrieved successfully', {
 *   requestId: correlationId,
 *   meta: {
 *     page: 1,
 *     pageSize: 20,
 *     total: 100,
 *     totalPages: 5,
 *   },
 *   links: {
 *     self: '/users?page=1',
 *     next: '/users?page=2',
 *     prev: null,
 *   },
 * });
 *
 * // 201 Created - Resource created
 * return created(newUser, 'User created successfully', {
 *   requestId: correlationId,
 * });
 *
 * // 202 Accepted - Async operation accepted
 * return accepted({ jobId: 'job-123' }, 'Processing request accepted', {
 *   requestId: correlationId,
 * });
 *
 * // 204 No Content - Success with no body
 * return noContent();
 */

// ============================================================================
// SAMPLE JSON API RESPONSES (JSON Output)
// ============================================================================

/**
 * SAMPLE ERROR RESPONSE JSON OUTPUTS (JSON API Format with MessageObject):
 * Reference: https://medium.com/@bojanmajed/standard-json-api-response-format-c6c1aabcaa6d
 *
 * // 400 Bad Request
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Invalid request",
 *     "description": "Invalid request",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "BAD_REQUEST",
 *       "message": "Missing required field: email"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 400 Bad Request - File Deletion Failed (example)
 * {
 *   "status": false,
 *   "message": {
 *     "title": "File Deletion Failed",
 *     "description": "The file could not be deleted due to invalid permissions",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "FILE_DELETE_FAILED",
 *       "message": "Insufficient permissions to delete file"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 401 Unauthorized
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Authentication Required",
 *     "description": "Please provide a valid authentication token",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "UNAUTHORIZED",
 *       "message": "Please provide a valid authentication token"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 403 Forbidden
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Access Denied",
 *     "description": "You do not have permission to access this resource",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "FORBIDDEN",
 *       "message": "You do not have permission to access this resource"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 404 Not Found
 * {
 *   "status": false,
 *   "message": {
 *     "title": "User Not Found",
 *     "description": "User with ID abc123 does not exist",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "USER_NOT_FOUND",
 *       "message": "User with ID abc123 does not exist"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 409 Conflict
 * {
 *   "status": false,
 *   "message": {
 *     "title": "User Already Exists",
 *     "description": "User with email user@example.com already exists",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "USER_ALREADY_EXISTS",
 *       "message": "User with email user@example.com already exists"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 422 Unprocessable Entity (with validation errors)
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Validation Failed",
 *     "description": "The request contains validation errors",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "INVALID_EMAIL",
 *       "field": "email",
 *       "message": "Invalid email format"
 *     },
 *     {
 *       "code": "INVALID_AGE",
 *       "field": "age",
 *       "message": "Age must be a positive number"
 *     },
 *     {
 *       "code": "INVALID_PASSWORD",
 *       "field": "password",
 *       "message": "Password must be at least 8 characters"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 429 Too Many Requests
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Rate Limit Exceeded",
 *     "description": "You have exceeded the rate limit of 100 requests per minute",
 *     "severity": "warning"
 *   },
 *   "errors": [
 *     {
 *       "code": "RATE_LIMIT_EXCEEDED",
 *       "message": "You have exceeded the rate limit of 100 requests per minute"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 500 Internal Server Error
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Internal Server Error",
 *     "description": "An unexpected error occurred. Please try again later or contact support",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "INTERNAL_ERROR",
 *       "message": "An unexpected error occurred. Please try again later or contact support"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 502 Bad Gateway
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Upstream Service Unavailable",
 *     "description": "The payment service is currently unavailable",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "UPSTREAM_SERVICE_ERROR",
 *       "message": "The payment service is currently unavailable"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 503 Service Unavailable
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Service Temporarily Unavailable",
 *     "description": "The service is undergoing maintenance. Please try again in 30 minutes",
 *     "severity": "info"
 *   },
 *   "errors": [
 *     {
 *       "code": "SERVICE_UNAVAILABLE",
 *       "message": "The service is undergoing maintenance. Please try again in 30 minutes"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * // 504 Gateway Timeout
 * {
 *   "status": false,
 *   "message": {
 *     "title": "Gateway Timeout",
 *     "description": "The upstream service did not respond in time",
 *     "severity": "error"
 *   },
 *   "errors": [
 *     {
 *       "code": "GATEWAY_TIMEOUT",
 *       "message": "The upstream service did not respond in time"
 *     }
 *   ],
 *   "correlationId": "req-123"
 * }
 *
 * SAMPLE SUCCESS RESPONSE JSON OUTPUTS (JSON API Format):
 *
 * // 200 OK - Simple response
 * {
 *   "status": true,
 *   "message": "User retrieved successfully",
 *   "data": {
 *     "userId": "abc123",
 *     "name": "John Doe",
 *     "email": "john@example.com"
 *   },
 *   "requestId": "req-123"
 * }
 *
 * // 200 OK - With pagination
 * {
 *   "status": true,
 *   "message": "Users retrieved successfully",
 *   "data": [
 *     { "userId": "abc123", "name": "John Doe" },
 *     { "userId": "def456", "name": "Jane Smith" }
 *   ],
 *   "meta": {
 *     "page": 1,
 *     "pageSize": 20,
 *     "total": 100,
 *     "totalPages": 5
 *   },
 *   "links": {
 *     "self": "/users?page=1",
 *     "next": "/users?page=2",
 *     "prev": null
 *   },
 *   "requestId": "req-123"
 * }
 *
 * // 201 Created
 * {
 *   "status": true,
 *   "message": "Resource created successfully",
 *   "data": {
 *     "userId": "new-abc123",
 *     "name": "John Doe",
 *     "email": "john@example.com",
 *     "createdAt": "2024-01-15T10:30:00Z"
 *   },
 *   "requestId": "req-123"
 * }
 *
 * // 202 Accepted (async operation)
 * {
 *   "status": true,
 *   "message": "Request accepted for processing",
 *   "data": {
 *     "jobId": "job-123",
 *     "status": "processing",
 *     "estimatedCompletion": "2024-01-15T10:35:00Z"
 *   },
 *   "requestId": "req-123"
 * }
 *
 * // 204 No Content - Empty body, status code 204
 */

