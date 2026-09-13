import { LambdaRequest, ValidationError } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { BadRequestError } from '../errors';
import { validateUpdateOnboardingRequest } from './onboarding.schema';

function request(body: unknown): LambdaRequest {
  return { body } as LambdaRequest;
}

describe('validateUpdateOnboardingRequest', () => {
  it('rejects an unknown section with BAD_REQUEST', () => {
    expect(() =>
      validateUpdateOnboardingRequest(
        request({ section: 'PRICING', data: {} }),
      ),
    ).toThrow(BadRequestError);
  });

  it('rejects a BUSINESS_INFO payload that contains bank fields', () => {
    expect(() =>
      validateUpdateOnboardingRequest(
        request({
          section: 'BUSINESS_INFO',
          data: {
            vendorType: 'BUSINESS',
            businessName: 'ABC Car Wash',
            contactName: 'Priya',
            phoneNumber: '+919876543210',
            accountNumber: '123456789012',
          },
        }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('accepts a valid BUSINESS_INFO section payload', () => {
    const result = validateUpdateOnboardingRequest(
      request({
        section: 'BUSINESS_INFO',
        data: {
          vendorType: 'BUSINESS',
          businessName: 'ABC Car Wash',
          contactName: 'Priya',
          phoneNumber: '+919876543210',
        },
      }),
    );

    expect(result.section).toBe('BUSINESS_INFO');
    expect(result.data).toMatchObject({ businessName: 'ABC Car Wash' });
  });

  it('requires data for a known section', () => {
    expect(() =>
      validateUpdateOnboardingRequest(
        request({ section: 'ADDRESS' }),
      ),
    ).toThrow(ValidationError);
  });
});
