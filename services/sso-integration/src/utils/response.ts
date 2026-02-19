/**
 * API Gateway response utilities
 */

import { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function successResponse(data: unknown, statusCode = 200): APIGatewayProxyResult {
  return jsonResponse(statusCode, { success: true, data });
}

export function errorResponse(message: string, statusCode = 400, code?: string): APIGatewayProxyResult {
  return jsonResponse(statusCode, {
    success: false,
    error: code || 'ERROR',
    message,
  });
}
