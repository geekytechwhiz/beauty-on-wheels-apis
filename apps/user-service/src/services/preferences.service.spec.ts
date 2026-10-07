import { ForbiddenError, LambdaRequest, NotFoundError } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { PreferencesService } from './preferences.service';
import { PreferencesRepository } from '../repositories/preferences.repository';
import { CustomersRepository } from '../repositories/customers.repository';
import { validateOperationalPreferencesUpdate } from '../schemas/preferences.schema';
import { CustomerProfileRecord } from '../types/records';

function request(overrides: Record<string, unknown> = {}): LambdaRequest {
  const context = {
    userContext: { userId: 'user-1', roles: ['customer'] },
    ...(overrides.context as object),
  };
  return {
    pathParameters: { userId: 'user-1' },
    params: { userId: 'user-1' },
    body: {},
    ...overrides,
    context,
  } as unknown as LambdaRequest;
}

describe('PreferencesService', () => {
  let preferences: jest.Mocked<
    Pick<PreferencesRepository, 'getPreferences' | 'savePreferences'>
  >;
  let customers: jest.Mocked<Pick<CustomersRepository, 'getProfile'>>;
  let service: PreferencesService;

  beforeEach(() => {
    preferences = {
      getPreferences: jest.fn().mockResolvedValue(null),
      savePreferences: jest.fn().mockResolvedValue(undefined),
    };
    customers = {
      getProfile: jest.fn().mockResolvedValue({
        userId: 'user-1',
      } as CustomerProfileRecord),
    };
    service = new PreferencesService(
      preferences as unknown as PreferencesRepository,
      customers as unknown as CustomersRepository,
    );
  });

  it('returns every operational channel enabled when nothing is stored', async () => {
    const result = await service.getPreferences(request());

    expect(result).toEqual({
      userId: 'user-1',
      whatsapp: true,
      sms: true,
      email: true,
      push: true,
    });
    expect(preferences.savePreferences).not.toHaveBeenCalled();
  });

  it('stores channel flags and not marketing consent', async () => {
    const saved = await service.putPreferences(
      request({
        body: {
          whatsapp: true,
          sms: false,
          email: true,
          push: false,
        },
      }),
    );

    expect(saved.sms).toBe(false);
    expect(saved.push).toBe(false);
    expect(saved).not.toHaveProperty('marketingConsent');
  });

  it('requires a customer profile before a write', async () => {
    customers.getProfile.mockResolvedValue(null);
    await expect(
      service.putPreferences(
        request({
          body: { whatsapp: true, sms: true, email: true, push: true },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects another customer', async () => {
    await expect(
      service.getPreferences(
        request({
          context: { userContext: { userId: 'user-2', roles: ['customer'] } },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects marketing consent on the preference contract', () => {
    expect(() =>
      validateOperationalPreferencesUpdate(
        request({
          body: {
            whatsapp: true,
            sms: true,
            email: true,
            push: true,
            marketingConsent: true,
          },
        }),
      ),
    ).toThrow(EventSchemaError);
  });
});
