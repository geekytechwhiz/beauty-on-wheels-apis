import { LambdaRequest } from '@api-hub/utils';

import { validateSendOtpRequest, validateVerifyOtpRequest } from './otp.schema';

describe('SendOtpRequestSchema', () => {
  it('defaults omitted userType to CUSTOMER', () => {
    expect(validateSendOtpRequest({
      body: { destination: '+919876543210' },
    } as LambdaRequest)).toEqual({
      destination: '+919876543210',
      userType: 'CUSTOMER',
    });
  });

  it.each(['ADMIN', 'operator', ''])('rejects public userType %s', (userType) => {
    expect(() => validateSendOtpRequest({
      body: { destination: '+919876543210', userType },
    } as LambdaRequest)).toThrow('Request validation failed');
  });

  it('rejects a send body without a destination', () => {
    expect(() => validateSendOtpRequest({
      body: {},
    } as LambdaRequest)).toThrow('Request validation failed');
  });
});

describe('VerifyOtpRequestSchema', () => {
  it('accepts destination and otp', () => {
    expect(validateVerifyOtpRequest({
      body: { destination: '+919876543210', otp: '123456' },
    } as LambdaRequest)).toEqual({
      destination: '+919876543210',
      otp: '123456',
    });
  });

  it('rejects a verify body that omits the otp', () => {
    expect(() => validateVerifyOtpRequest({
      body: { destination: '+919876543210' },
    } as LambdaRequest)).toThrow('Request validation failed');
  });
});
