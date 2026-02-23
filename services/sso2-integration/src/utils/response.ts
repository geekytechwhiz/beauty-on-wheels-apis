// ─────────────────────────────────────────────────────────────────────────────
// API GATEWAY RESPONSE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyResult } from "aws-lambda";
import { ApiErrorResponse } from "../types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key,X-HMS-Client-Id",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Content-Type": "application/json",
};

/**
 * Build a successful API Gateway response.
 */
export function successResponse<T>(
  data: T,
  statusCode: 200 | 201 | 204 = 200
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

/**
 * Build an error API Gateway response.
 */
export function errorResponse(
  statusCode: number,
  error: string,
  message: string,
  requestId?: string
): APIGatewayProxyResult {
  const body: ApiErrorResponse = {
    error,
    message,
    requestId,
    timestamp: new Date().toISOString(),
  };

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

// ── Common Error Responses ────────────────────────────────────────────────────

export const Responses = {
  badRequest: (message: string, requestId?: string) =>
    errorResponse(400, "BAD_REQUEST", message, requestId),

  unauthorized: (message = "Invalid or missing credentials", requestId?: string) =>
    errorResponse(401, "UNAUTHORIZED", message, requestId),

  forbidden: (message = "Access denied", requestId?: string) =>
    errorResponse(403, "FORBIDDEN", message, requestId),

  notFound: (resource: string, requestId?: string) =>
    errorResponse(404, "NOT_FOUND", `${resource} not found`, requestId),

  conflict: (message: string, requestId?: string) =>
    errorResponse(409, "CONFLICT", message, requestId),

  gone: (message: string, requestId?: string) =>
    errorResponse(410, "GONE", message, requestId),

  internalError: (requestId?: string) =>
    errorResponse(500, "INTERNAL_SERVER_ERROR", "An unexpected error occurred", requestId),
};
