import { APIGatewayProxyResult } from 'aws-lambda';
import { ApiResponseBody, Meta, ResponseOptions, ErrorBody } from '../types/core-types';
import { DefaultErrorCodes } from '../enums/http-status';

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

function normalizeData<T>(data: T | null) {
  if (Array.isArray(data)) {
    return { items: data };
  }
  return data ?? null;
}

export function buildResponse<T>(
  statusCode: number,
  message: any,
  data: T | null,
  options: ResponseOptions,
  error?: ErrorBody
): APIGatewayProxyResult {

  const success = statusCode < 400;

  const body: ApiResponseBody<any> = {
    success,
    statusCode,
    message,
    data: success ? normalizeData(data) : null,
    error: success ? null : error ?? { code: DefaultErrorCodes[statusCode] },
    meta: buildMeta(options),
  };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(body),
  };
}