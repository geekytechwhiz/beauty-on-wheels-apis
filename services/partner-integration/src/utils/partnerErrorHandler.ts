import type { APIGatewayProxyevent: any, APIGatewayProxyResult } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import {
  InvalidPartnerResponseError,
  PartnerUnavailableError,
  PartnerAuthenticationError,
  PartnerNotFoundError,
} from '@api-hub/lab-integration';
import {
  PartnerUnavailableError as ServicePartnerUnavailableError,
  UnsupportedPartnerError,
  InvalidPartnerResponseError as ServiceInvalidPartnerResponseError,
} from './integrationErrors';
import { responseOpts } from './handlerHelpers';

/**
 * Maps known partner-integration errors to the appropriate API response.
 * Returns the response for known errors, or null if the error is not handled
 * (caller should return 500).
 */
export async function handlePartnerIntegrationError(
  err: unknown,
  event: APIGatewayProxyevent: any,
  requestId: string
): Promise<APIGatewayProxyResult | null> {
  const opts = () => responseOpts(event: any, requestId);
  const details = (code: string, message: string) => ({ code, details: [{ message }] });

  if (err instanceof UnsupportedPartnerError) {
    return ApiResponse.badRequest(
      'PARTNER_INTEGRATION.UNSUPPORTED_PARTNER',
      opts(),
      details('UNSUPPORTED_PARTNER', err.message)
    );
  }
  if (err instanceof ServicePartnerUnavailableError || err instanceof PartnerUnavailableError) {
    return ApiResponse.error(
      503,
      'PARTNER_INTEGRATION.PARTNER_UNAVAILABLE',
      opts(),
      details('PARTNER_UNAVAILABLE', err.message)
    );
  }
  if (err instanceof InvalidPartnerResponseError || err instanceof ServiceInvalidPartnerResponseError) {
    return ApiResponse.error(
      502,
      'PARTNER_INTEGRATION.INVALID_PARTNER_RESPONSE',
      opts(),
      details('INVALID_PARTNER_RESPONSE', err.message)
    );
  }
  if (err instanceof PartnerAuthenticationError) {
    return ApiResponse.badRequest(
      'PARTNER_INTEGRATION.AUTH_FAILED',
      opts(),
      details('AUTH_FAILED', err.message)
    );
  }
  if (err instanceof PartnerNotFoundError) {
    return ApiResponse.badRequest(
      'PARTNER_INTEGRATION.NOT_FOUND',
      opts(),
      details('NOT_FOUND', err.message)
    );
  }
  if (err instanceof Error) {
    if (err.message?.includes('No adapter registered')) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_PARTNER',
        opts(),
        details('UNSUPPORTED_PARTNER', err.message)
      );
    }
    if (err.message?.includes('not supported')) {
      return ApiResponse.badRequest(
        'PARTNER_INTEGRATION.UNSUPPORTED_OPERATION',
        opts(),
        details('UNSUPPORTED_OPERATION', err.message)
      );
    }
  }

  return null;
}
