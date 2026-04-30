import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { serializeError } from '@api-hub/logger';

import { AppError } from '../errors/app.error';
import { ErrorHandlerOptions, Message } from '../types/core-types';
import { ApiResponse } from '../helper/http-response.helpers';
import { resolveMessage } from '../helper/message.helpers';

/**
 * Local fallback titles used when the CDN does not contain the error key.
 * Keys are error codes; values are human-readable titles.
 */
const ERROR_TITLES: Record<string, string> = {
  // ── Generic HTTP ────────────────────────────────────────────────────────────
  BAD_REQUEST:                        'Bad request',
  INVALID_REQUEST:                    'Invalid request',
  UNAUTHORIZED:                       'Unauthorized',
  FORBIDDEN:                          'Access denied',
  RESOURCE_NOT_FOUND:                 'Resource not found',
  NOT_FOUND:                          'Not found',
  CONFLICT:                           'Conflict',
  VALIDATION_ERROR:                   'Validation error',
  INTERNAL_SERVER_ERROR:              'Internal server error',

  // ── Auth / User ─────────────────────────────────────────────────────────────
  USER_NOT_FOUND:                     'User not found',
  USER_ALREADY_EXISTS:                'User already exists',
  USER_ALREADY_ADDED_AS_FNF:          'User already added',
  USER_ALREADY_INVITED:               'User already invited',
  USER_ALREADY_INVITED_BY_SOMEONE:    'Already invited by someone else',

  // ── Friend & Family ─────────────────────────────────────────────────────────
  USER_CANNOT_INVITE_MORE_FNF:        'Friend & Family limit reached',
  FNF_DOES_NOT_EXIST:                 'Friend or family member not found',
  MEMBER_NOT_FOUND:                   'Member not found',

  // ── Organisation ────────────────────────────────────────────────────────────
  ORGANIZATION_NOT_EXIST:             'Organization not found',
  ORGANIZATION_IS_ON_HOLD:            'Organization is on hold',
  ORGANIZATION_MISMATCH:              'Organization mismatch',

  // ── Other ────────────────────────────────────────────────────────────────────
  EMAIL_OR_PHONE_REQUIRED:            'Email or phone number required',

  // ── Metadata registry ────────────────────────────────────────────────────────
  METADATA_TYPE_INACTIVE:              'Metadata type is inactive',
};

/**
 * Maps application errors → standardized HTTP response.
 * Fetches title / description / severity from the CDN using the error code as
 * the lookup key.  Falls back to LOCAL_ERROR_TITLES when CDN is not configured
 * or the key is missing, so the title is always human-readable.
 */
export async function handleError(
  error: AppError,
  options: ErrorHandlerOptions = {}
): Promise<APIGatewayProxyResult> {

  const { correlationId, logger } = options;

  const statusCode = error?.statusCode ?? 500;
  const errorCode = error?.code ?? mapStatusToCode(statusCode);
  const rawDescription = error?.message ?? 'Unexpected server error';

  const requestId = correlationId ?? 'unknown';

  /**
   * Structured logging
   */
  if (logger) {
    logger.error({
      event: 'lambda_error',
      requestId,
      statusCode,
      errorCode,
      error: serializeError(error),
    });
  }

  // Local fallback title/description used when CDN has no entry for this code
  const localTitle       = ERROR_TITLES[errorCode] ?? errorCode;
  const localDescription = rawDescription;

  /**
   * Resolve title / description from CDN using the error code as the key.
   * The event (API Gateway event) is used to detect Accept-Language for i18n.
   * If CDN is unreachable or key is missing, localTitle/localDescription are
   * used so the response title is always human-readable.
   */
  const cdnMessage = await resolveMessage(
    (options.event ?? {}) as APIGatewayProxyEvent,
    errorCode,
    {
      title: localTitle,
      description: localDescription,
      severity: 'ERROR',
    },
  ).catch(() => ({
    title: localTitle,
    description: localDescription,
    severity: 'ERROR' as const,
  }));
  // console.log("CDN ERROR MESSAGE : ",cdnMessage);
  // For INTERNAL_SERVER_ERROR, prefer the thrown error message so AWS/DynamoDB details are not replaced by CDN copy.
  const descriptionForClient =
    errorCode === 'INTERNAL_SERVER_ERROR' ? localDescription : cdnMessage.description;
  const message: Message = {
    title: errorCode === 'INVITE_UPDATE_TOO_SOON' ? cdnMessage.description : cdnMessage.title,
    description: descriptionForClient,
    severity: cdnMessage.severity,
  };

  const errorPayload = {
    code: errorCode,
    details: error?.details ?? [{ message: rawDescription }],
  };

  const optionsPayload = { requestId };

  switch (statusCode) {

    case 400:
      return ApiResponse.badRequest(
        message,
        optionsPayload,
        errorPayload
      );

    case 401:
      return ApiResponse.unauthorized(
        message,
        optionsPayload,
        errorPayload
      );

    case 403:
      return ApiResponse.forbidden(
        message,
        optionsPayload,
        errorPayload
      );

    case 404:
      return ApiResponse.notFound(
        message,
        optionsPayload,
        errorPayload
      );

    case 409:
      return ApiResponse.conflict(
        message,
        optionsPayload,
        errorPayload
      );

    case 429:
      return ApiResponse.error(
        429,
        message,
        optionsPayload,
        errorPayload
      );

    default:
      return ApiResponse.internalServerError(
        message,
        optionsPayload,
        errorPayload
      );
  }
}

/**
 * Default mapping when error does not provide a code
 */
function mapStatusToCode(statusCode: number): string {

  switch (statusCode) {

    case 400:
      return 'INVALID_REQUEST';

    case 401:
      return 'UNAUTHORIZED';

    case 403:
      return 'FORBIDDEN';

    case 404:
      return 'RESOURCE_NOT_FOUND';

    case 409:
      return 'CONFLICT';

    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}
