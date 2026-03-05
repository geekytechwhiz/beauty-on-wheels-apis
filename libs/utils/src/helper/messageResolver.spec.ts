import type { APIGatewayProxyEvent } from 'aws-lambda';
import { getErrorDefinition } from 'libs/http-client/src';
import { getErrorMessage, getLanguageFromHeaders, normalizeSeverity } from './messageResolver';

jest.mock('./headerUtils', () => ({
  extractLanguageFromEvent: jest.fn((event: APIGatewayProxyEvent) => {
    const h = event?.headers || {};
    return (
      h['accept-language'] ||
      h['Accept-Language'] ||
      h['x-language'] ||
      h['X-Language'] ||
      null
    );
  }),
}));

const getErrorDefinitionMock = getErrorDefinition as jest.Mock;

function makeEvent(headers?: Record<string, string>): APIGatewayProxyEvent {
  return {
    headers: headers ?? {},
  } as unknown as APIGatewayProxyEvent;
}

describe('messageResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLanguageFromHeaders', () => {
    it('extracts primary language from Accept-Language', () => {
      const enUs: Record<string, string> = {};
      enUs['Accept-Language'] = 'en-US';
      expect(getLanguageFromHeaders(makeEvent(enUs))).toBe('en');
      const frHeaders: Record<string, string> = {};
      frHeaders['accept-language'] = 'fr-CA';
      expect(getLanguageFromHeaders(makeEvent(frHeaders))).toBe('fr');
    });

    it('defaults to en when missing or invalid', () => {
      expect(getLanguageFromHeaders(makeEvent())).toBe('en');
      const invalid: Record<string, string> = {};
      invalid['Accept-Language'] = '123';
      expect(getLanguageFromHeaders(makeEvent(invalid))).toBe('en');
    });
  });

  describe('normalizeSeverity', () => {
    it('returns allowed severity as-is (uppercase)', () => {
      expect(normalizeSeverity('error', 'ERROR')).toBe('ERROR');
      expect(normalizeSeverity('SUCCESS', 'ERROR')).toBe('SUCCESS');
    });

    it('returns default for unknown severity', () => {
      expect(normalizeSeverity('unknown', 'ERROR')).toBe('ERROR');
      expect(normalizeSeverity(undefined, 'WARNING')).toBe('WARNING');
    });
  });

  describe('getErrorMessage', () => {
    it('returns definition from error-messages when getErrorDefinition returns one', async () => {
      getErrorDefinitionMock.mockResolvedValue({
        title: 'Validation Failed',
        description: 'The request body is invalid.',
        severity: 'error',
      });
      const enHeaders: Record<string, string> = {};
      enHeaders['Accept-Language'] = 'en';
      const event = makeEvent(enHeaders);
      const result = await getErrorMessage(event, 'COMMON.VALIDATION_ERROR');
      expect(result).toEqual({
        title: 'Validation Failed',
        description: 'The request body is invalid.',
        severity: 'ERROR',
      });
      expect(getErrorDefinitionMock).toHaveBeenCalledWith('COMMON.VALIDATION_ERROR', 'en');
    });

    it('returns defaults when getErrorDefinition returns undefined', async () => {
      getErrorDefinitionMock.mockResolvedValue(undefined);
      const result = await getErrorMessage(makeEvent(), 'UNKNOWN.KEY');
      expect(result).toEqual({
        title: 'Error',
        description: 'An error occurred',
        severity: 'ERROR',
      });
    });

    it('returns defaults when getErrorDefinition throws', async () => {
      getErrorDefinitionMock.mockRejectedValue(new Error('CDN unreachable'));
      const result = await getErrorMessage(makeEvent(), 'ANY.KEY');
      expect(result).toEqual({
        title: 'Error',
        description: 'An error occurred',
        severity: 'ERROR',
      });
    });
  });
});
