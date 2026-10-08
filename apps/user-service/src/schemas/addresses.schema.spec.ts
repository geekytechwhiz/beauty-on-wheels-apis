import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { validateAddressRequest } from './addresses.schema';

function request(body: unknown): LambdaRequest {
  return { body } as unknown as LambdaRequest;
}

describe('validateAddressRequest', () => {
  it('accepts a Kochi address with an India PIN', () => {
    const parsed = validateAddressRequest(
      request({
        line1: '12 Palm Street',
        city: 'Kochi',
        state: 'Kerala',
        country: 'India',
        postalCode: '682001',
      }),
    );

    expect(parsed.postalCode).toBe('682001');
  });

  it('rejects an India PIN that is not 6 digits', () => {
    expect(() =>
      validateAddressRequest(
        request({
          line1: '12 Palm Street',
          city: 'Kochi',
          country: 'IN',
          postalCode: '6820',
        }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('rejects a blank line1', () => {
    expect(() =>
      validateAddressRequest(
        request({
          line1: '   ',
          city: 'Kochi',
        }),
      ),
    ).toThrow(EventSchemaError);
  });
});
