import { BaseError } from '@api-hub/utils';

export const CHANNEL_ERROR_CODE = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAVAILABLE: 'UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
  META_API_ERROR: 'META_API_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODE)[keyof typeof CHANNEL_ERROR_CODE];

const STATUS_BY_CODE: Record<ChannelErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAVAILABLE: 503,
  TIMEOUT: 504,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  META_API_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class ChannelError extends BaseError {
  constructor(
    code: ChannelErrorCode,
    message: string,
    options?: { retryable?: boolean; metadata?: Record<string, unknown>; statusCode?: number },
  ) {
    super(message, options?.statusCode ?? STATUS_BY_CODE[code], code, undefined, {
      retryable: options?.retryable,
      metadata: options?.metadata,
    });
    this.name = 'ChannelError';
  }
}

export function isChannelError(error: unknown): error is ChannelError {
  return error instanceof ChannelError;
}

export function customerMessage(error: unknown): string {
  const code = error instanceof BaseError ? error.code : CHANNEL_ERROR_CODE.INTERNAL_ERROR;
  switch (code) {
    case CHANNEL_ERROR_CODE.NOT_FOUND:
      return 'I could not find that option. Please choose again from the list.';
    case CHANNEL_ERROR_CODE.CONFLICT:
      return 'That selection is no longer available. Please choose another option.';
    case CHANNEL_ERROR_CODE.TIMEOUT:
    case CHANNEL_ERROR_CODE.UNAVAILABLE:
      return 'A booking service is temporarily unavailable. Please try again in a moment.';
    case CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR:
    case CHANNEL_ERROR_CODE.AUTHORIZATION_ERROR:
      return 'I could not access the booking services just now. Please try again later.';
    case CHANNEL_ERROR_CODE.VALIDATION_ERROR:
      return 'Something in that request was not valid. Please try again.';
    case CHANNEL_ERROR_CODE.META_API_ERROR:
      return 'I could not send a WhatsApp message just now. Please try again.';
    default:
      return 'Sorry, something went wrong. Please reply MENU to start again.';
  }
}

export function fromHttpStatus(status: number, dependency: string, bodyText: string): ChannelError {
  const notImplemented = /not implemented/i.test(bodyText);
  let code: ChannelErrorCode = CHANNEL_ERROR_CODE.INTERNAL_ERROR;
  if (status === 400 || status === 422) code = CHANNEL_ERROR_CODE.VALIDATION_ERROR;
  else if (status === 401) code = CHANNEL_ERROR_CODE.AUTHENTICATION_ERROR;
  else if (status === 403) code = CHANNEL_ERROR_CODE.AUTHORIZATION_ERROR;
  else if (status === 404) code = CHANNEL_ERROR_CODE.NOT_FOUND;
  else if (status === 409) code = CHANNEL_ERROR_CODE.CONFLICT;
  else if (status === 408 || status === 504) code = CHANNEL_ERROR_CODE.TIMEOUT;
  else if (status === 429 || status === 503 || status === 501 || notImplemented) code = CHANNEL_ERROR_CODE.UNAVAILABLE;

  const retryable = code === CHANNEL_ERROR_CODE.TIMEOUT || code === CHANNEL_ERROR_CODE.UNAVAILABLE;
  return new ChannelError(code, `${dependency} request failed with status ${status}`, {
    retryable,
    statusCode: status,
    metadata: { dependency, status },
  });
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
