import { LambdaRequest, NotFoundError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  toOperationalPreferences,
  toPreferencesRecord,
} from '../mappers/preferences.mapper';
import {
  CustomersRepository,
  getCustomersRepository,
} from '../repositories/customers.repository';
import {
  getPreferencesRepository,
  PreferencesRepository,
} from '../repositories/preferences.repository';
import {
  OperationalPreferences,
  OperationalPreferencesUpdate,
} from '../types/api-types';
import { assertOwnerAdminOrService, assertOwnerOrAdmin, getUserId } from '../utils';

const baseLogger = createLogger({
  service: 'preferences-service',
  redactPII: true,
});

export class PreferencesService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'PreferencesService',
  });

  constructor(
    private readonly preferences: PreferencesRepository = getPreferencesRepository(),
    private readonly customers: CustomersRepository = getCustomersRepository(),
  ) {}

  async getPreferences(request: LambdaRequest): Promise<OperationalPreferences> {
    const userId = getUserId(request);
    assertOwnerAdminOrService(request, userId);

    const record = await this.preferences.getPreferences(userId);

    this.logger.info({
      event: 'get_preferences_success',
      userId,
      stored: Boolean(record),
    });

    return toOperationalPreferences(record ?? undefined, userId);
  }

  async putPreferences(request: LambdaRequest): Promise<OperationalPreferences> {
    const userId = getUserId(request);
    assertOwnerOrAdmin(request, userId);

    const profile = await this.customers.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('Customer profile not found');
    }

    const body = request.body as OperationalPreferencesUpdate;
    const existing = await this.preferences.getPreferences(userId);
    const now = new Date().toISOString();
    const record = toPreferencesRecord({
      userId,
      whatsapp: body.whatsapp,
      sms: body.sms,
      email: body.email,
      push: body.push,
      language: body.language,
      timezone: body.timezone,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    await this.preferences.savePreferences(record);

    this.logger.info({
      event: 'put_preferences_success',
      userId,
    });

    return toOperationalPreferences(record, userId);
  }
}

let service: PreferencesService;

export function getPreferencesService(): PreferencesService {
  if (!service) {
    service = new PreferencesService();
  }
  return service;
}
