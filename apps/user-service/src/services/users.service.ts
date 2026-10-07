import { LambdaRequest, NotFoundError, ValidationError } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { requireE164 } from '../domain/phone';
import { toPhoneLookupResult, toUser } from '../mappers/customers.mapper';
import {
  CustomersRepository,
  getCustomersRepository,
} from '../repositories/customers.repository';
import { PhoneLookupResult, User } from '../types/api-types';
import {
  assertOwnerAdminOrService,
  assertServiceOrAdmin,
  getQueryParam,
  getUserId,
} from '../utils';

const baseLogger = createLogger({
  service: 'users-service',
  redactPII: true,
});

export class UsersService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'UsersService',
  });

  constructor(
    private readonly customers: CustomersRepository = getCustomersRepository(),
  ) {}

  async lookupByPhone(request: LambdaRequest): Promise<PhoneLookupResult> {
    assertServiceOrAdmin(request);

    const phone = getQueryParam(request, 'phone');
    if (!phone) {
      throw new ValidationError('phone is required');
    }

    const e164 = requireE164(phone);
    const lookup = await this.customers.getPhoneLookup(e164);
    if (!lookup) {
      throw new NotFoundError('User not found');
    }

    this.logger.info({
      event: 'lookup_user_by_phone_success',
      userId: lookup.userId,
    });

    return toPhoneLookupResult(lookup);
  }

  async getUser(request: LambdaRequest): Promise<User> {
    const userId = getUserId(request);
    assertOwnerAdminOrService(request, userId);

    const profile = await this.customers.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('User not found');
    }

    this.logger.info({
      event: 'get_user_success',
      userId,
    });

    return toUser(profile);
  }
}

let service: UsersService;

export function getUsersService(): UsersService {
  if (!service) {
    service = new UsersService();
  }
  return service;
}
