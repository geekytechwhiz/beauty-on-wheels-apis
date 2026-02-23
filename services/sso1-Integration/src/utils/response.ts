/**
 * HTTP response helper utilities for API Gateway Lambda handlers.
 * All responses include CORS headers and a consistent JSON envelope.
 */

import type { APIGatewayProxyResult } from "../types";

// ─── CORS Headers ─────────────────────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Credentials": "true",
};

// ─── Base response builder ────────────────────────────────────────────────────
function buildResponse(
  statusCode: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

// ─── Success responses ────────────────────────────────────────────────────────

/** 200 OK */
export function ok<T>(data: T, message?: string): APIGatewayProxyResult {
  return buildResponse(200, {
    success: true,
    statusCode: 200,
    message: message ?? "OK",
    data,
  });
}

/** 201 Created */
export function created<T>(data: T, message?: string): APIGatewayProxyResult {
  return buildResponse(201, {
    success: true,
    statusCode: 201,
    message: message ?? "Created",
    data,
  });
}

// ─── Redirect response ────────────────────────────────────────────────────────

/** 302 Redirect */
export function redirect(location: string): APIGatewayProxyResult {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      ...CORS_HEADERS,
    },
    body: "",
  };
}

// ─── Error responses ──────────────────────────────────────────────────────────

/** 400 Bad Request */
export function badRequest(error: string, message?: string): APIGatewayProxyResult {
  return buildResponse(400, {
    success: false,
    statusCode: 400,
    error,
    message: message ?? "Bad Request",
  });
}

/** 401 Unauthorized */
export function unauthorized(message = "Unauthorized"): APIGatewayProxyResult {
  return buildResponse(401, {
    success: false,
    statusCode: 401,
    error: "UNAUTHORIZED",
    message,
  });
}

/** 403 Forbidden */
export function forbidden(message = "Forbidden"): APIGatewayProxyResult {
  return buildResponse(403, {
    success: false,
    statusCode: 403,
    error: "FORBIDDEN",
    message,
  });
}

/** 404 Not Found */
export function notFound(message = "Resource not found"): APIGatewayProxyResult {
  return buildResponse(404, {
    success: false,
    statusCode: 404,
    error: "NOT_FOUND",
    message,
  });
}

/** 500 Internal Server Error */
export function internalServerError(
  message = "An unexpected error occurred"
): APIGatewayProxyResult {
  return buildResponse(500, {
    success: false,
    statusCode: 500,
    error: "INTERNAL_SERVER_ERROR",
    message,
  });
}
