import { APIGatewayProxyResult } from 'aws-lambda';
import { Meta, ResponseOptions, ApiResponseBody, Message, ErrorBody } from '../types/core-types';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,X-Correlation-Id,X-Requested-With',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
  };
}

function now() {
  return new Date().toISOString();
}

function buildMeta(options: ResponseOptions): Meta {
  return {
    requestId: options.requestId,
    timestamp: now(),
    version: 'v1',
  };
}

function createResponse<T>(
  statusCode: number,
  body: ApiResponseBody<T>,
  headers?: Record<string, string>,
): APIGatewayProxyResult {

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  };
}

/**
 * Normalize response data
 * Arrays become { items: [] }
 */
function normalizeData<T>(data: T | null): any {
  if (Array.isArray(data)) {
    return { items: data };
  }
  return data ?? null;
}

export class ApiResponse {

  static ok<T>(
    data: T | null,
    message: Message,
    options: ResponseOptions,
  ): APIGatewayProxyResult {

    return createResponse(
      200,
      {
        success: true,
        statusCode: 200,
        message,
        data: normalizeData(data),
        error: null,
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static created<T>(
    data: T | null,
    message: Message,
    options: ResponseOptions,
  ): APIGatewayProxyResult {

    return createResponse(
      201,
      {
        success: true,
        statusCode: 201,
        message,
        data: normalizeData(data),
        error: null,
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static badRequest(
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {

    return createResponse(
      400,
      {
        success: false,
        statusCode: 400,
        message,
        data: null,
        error: error ?? { code: 'BAD_REQUEST' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static unauthorized(
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {

    return createResponse(
      401,
      {
        success: false,
        statusCode: 401,
        message,
        data: null,
        error: error ?? { code: 'UNAUTHORIZED' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static forbidden(
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {

    return createResponse(
      403,
      {
        success: false,
        statusCode: 403,
        message,
        data: null,
        error: error ?? { code: 'FORBIDDEN' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static notFound(
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {

    return createResponse(
      404,
      {
        success: false,
        statusCode: 404,
        message,
        data: null,
        error: error ?? { code: 'NOT_FOUND' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static conflict(
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {

    return createResponse(
      409,
      {
        success: false,
        statusCode: 409,
        message,
        data: null,
        error: error ?? { code: 'CONFLICT' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  static internalServerError(
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {

    return createResponse(
      500,
      {
        success: false,
        statusCode: 500,
        message,
        data: null,
        error: error ?? { code: 'INTERNAL_ERROR' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }

  /** Generic error response for any status code (e.g. 400, 401, 403, 404, 409, 500). */
  static error(
    statusCode: number,
    message: Message,
    options: ResponseOptions,
    error?: ErrorBody,
  ): APIGatewayProxyResult {
    return createResponse(
      statusCode,
      {
        success: false,
        statusCode,
        message,
        data: null,
        error: error ?? { code: 'ERROR' },
        meta: buildMeta(options),
      },
      options.headers
    );
  }
}