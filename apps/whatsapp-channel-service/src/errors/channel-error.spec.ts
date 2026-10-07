import { customerMessage, fromHttpStatus, maskPhone } from './channel-error';

describe('channel errors', () => {
  it('classifies downstream HTTP statuses', () => {
    expect(fromHttpStatus(400, 'catalog', '').code).toBe('VALIDATION_ERROR');
    expect(fromHttpStatus(401, 'booking', '').code).toBe('AUTHENTICATION_ERROR');
    expect(fromHttpStatus(403, 'vendor', '').code).toBe('AUTHORIZATION_ERROR');
    expect(fromHttpStatus(404, 'catalog', '').code).toBe('NOT_FOUND');
    expect(fromHttpStatus(409, 'booking', '').code).toBe('CONFLICT');
    expect(fromHttpStatus(504, 'availability', '').code).toBe('TIMEOUT');
    expect(fromHttpStatus(503, 'pricing', '').code).toBe('UNAVAILABLE');
    expect(fromHttpStatus(500, 'availability', 'Not Implemented').code).toBe('UNAVAILABLE');
    expect(fromHttpStatus(500, 'booking', 'boom').code).toBe('INTERNAL_ERROR');
  });

  it('keeps customer copy free of internal detail and masks phones', () => {
    const error = fromHttpStatus(500, 'booking', 'customer 919800000000 failed');
    expect(customerMessage(error)).not.toContain('919800000000');
    expect(customerMessage(error)).not.toContain('boom');
    expect(maskPhone('919800000000')).toBe('********0000');
  });
});
