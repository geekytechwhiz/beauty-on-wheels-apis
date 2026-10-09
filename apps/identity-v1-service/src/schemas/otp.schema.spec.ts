import { LambdaRequest } from '@api-hub/utils';

import { validateSendOtpRequest } from './otp.schema';

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
});
