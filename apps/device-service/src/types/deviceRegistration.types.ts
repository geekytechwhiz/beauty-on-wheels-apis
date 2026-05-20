import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Logger } from '@api-hub/observability';

/**
 * User context required for device registration.
 * Extracted from authorizer (Cognito) or request body.
 */
export interface UserContext {
  userId: string | undefined;
  organizationId: string | undefined;
}

/**
 * Raw validation payload built from request body and user context.
 * Used as input to deviceRegistrationSchema.safeParse().
 */
export interface DeviceRegistrationValidationPayload {
  userId: string | undefined;
  organizationId: string | undefined;
  devices: unknown;
}

/**
 * Single item in the device registration success response.
 * Preserved for API contract compatibility.
 */
export interface DeviceRegistrationResultItem {
  message: string;
  statusCode: number;
  configDeviceId: string;
  deviceId: string;
}

/**
 * Context passed through the device registration handler.
 * Used for logging and response metadata.
 */
export interface DeviceRegistrationHandlerContext {
  correlationId: string;
  awsRequestId?: string;
  event: APIGatewayProxyEvent;
  startTime: number;
  logger: Logger;
}

/**
 * Result of parsing the request body.
 * Success carries the parsed body; failure indicates invalid JSON.
 */
export type ParseRequestBodyResult =
  | { success: true; body: unknown }
  | { success: false };

/**
 * Validated user context (userId and organizationId both present).
 * Used after validateUserContext() returns true.
 */
export interface ValidUserContext {
  userId: string;
  organizationId: string;
}
