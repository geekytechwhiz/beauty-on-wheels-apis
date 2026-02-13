import type { AxiosError } from 'axios';
import {
  InvalidPartnerResponseError,
  PartnerUnavailableError,
  PartnerAuthenticationError,
  PartnerNotFoundError,
} from './custom-errors';

/**
 * Translate partner API errors to standardized error types.
 * @param partnerId - Partner identifier for error context
 * @param error - Axios error from partner API call
 * @throws Standardized error type
 */
export function translateError(partnerId: string, error: unknown): never {
  if (!(error instanceof Error)) {
    throw new InvalidPartnerResponseError(partnerId, 'Unknown error occurred');
  }

  if (!isAxiosError(error)) {
    throw new PartnerUnavailableError(partnerId, error.message, error);
  }

  const axiosError = error as AxiosError;

  // Network errors (no response)
  if (!axiosError.response) {
    if (axiosError.code === 'ECONNABORTED') {
      throw new PartnerUnavailableError(partnerId, 'Request timeout');
    }
    throw new PartnerUnavailableError(partnerId, 'Network error', axiosError);
  }

  const { status, data } = axiosError.response;

  // 401/403 - Authentication errors
  if (status === 401 || status === 403) {
    throw new PartnerAuthenticationError(partnerId);
  }

  // 404 - Resource not found
  if (status === 404) {
    throw new PartnerNotFoundError(partnerId, 'Resource not found');
  }

  // 4xx - Client errors
  if (status >= 400 && status < 500) {
    throw new InvalidPartnerResponseError(
      partnerId,
      `Client error: ${status}`,
      status,
      data
    );
  }

  // 5xx - Server errors
  if (status >= 500) {
    throw new PartnerUnavailableError(
      partnerId,
      `Server error: ${status}`,
      axiosError
    );
  }

  // Unknown status
  throw new InvalidPartnerResponseError(
    partnerId,
    `Unexpected response status: ${status}`,
    status,
    data
  );
}

function isAxiosError(error: unknown): error is AxiosError {
  return (error as AxiosError).isAxiosError === true;
}
