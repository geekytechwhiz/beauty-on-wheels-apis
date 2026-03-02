import { serializeError } from '@api-hub/logger';
import type { Logger } from '@api-hub/logger';
import type { ParseRequestBodyResult } from '../types/deviceRegistration.types';

export interface ParseRequestBodyOptions {
  /** Log event name when parse fails (e.g. 'deviceUserRegister_parse_error'). */
  parseErrorEvent?: string;
}

/**
 * Parses API Gateway event body (string or object) to a typed value.
 * Does not throw; on JSON parse failure logs and returns success: false.
 *
 * @param eventBody - Raw body from APIGatewayProxyEvent (string | null)
 * @param logger - Structured logger for parse errors
 * @param options - Optional parseErrorEvent for log event name (default: 'parse_error')
 * @returns ParseRequestBodyResult - { success: true, body } or { success: false }
 */
export function parseRequestBody(
  eventBody: string | null | undefined,
  logger: Logger,
  options?: ParseRequestBodyOptions,
): ParseRequestBodyResult {
  const eventName = options?.parseErrorEvent ?? 'parse_error';
  if (eventBody == null) {
    return { success: true, body: undefined };
  }
  if (typeof eventBody !== 'string') {
    return { success: true, body: eventBody };
  }
  try {
    const body = JSON.parse(eventBody);
    return { success: true, body };
  } catch (err) {
    logger.error({ event: eventName, err: serializeError(err) });
    return { success: false };
  }
}
