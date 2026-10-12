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

  it('rejects a business info payload that contains bank fields', () => {
    expect(() =>
      validateUpdateOnboardingRequest(
        request({
          section: 'BUSINESS_INFO_AND_OWNER',
          data: {
            businessInfo: {
              businessType: 'BUSINESS',
              businessName: 'ABC Car Wash',
              contactName: 'Priya',
              phoneNumber: '+919876543210',
              accountNumber: '123456789012',
            },
            ownerDetails: {
              fullName: 'Priya Sharma',
            },
          },
        }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('accepts a valid business info and owner section payload', () => {
    const result = validateUpdateOnboardingRequest(
      request({
        section: 'BUSINESS_INFO_AND_OWNER',
        data: {
          businessInfo: {
            businessType: 'BUSINESS',
            businessName: 'ABC Car Wash',
            contactName: 'Priya',
            phoneNumber: '+919876543210',
          },
          ownerDetails: {
            fullName: 'Priya Sharma',
          },
        },
      }),
    );

    expect(result.section).toBe('BUSINESS_INFO_AND_OWNER');
    expect(result.data).toMatchObject({
      businessInfo: { businessName: 'ABC Car Wash' },
      ownerDetails: { fullName: 'Priya Sharma' },
    });
  });

  it('requires data for a known section', () => {
    expect(() =>
      validateUpdateOnboardingRequest(
        request({ section: 'SERVICE_LOCATION_AND_COVERAGE' }),
      ),
    ).toThrow(ValidationError);
  });
});
