import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { requireE164 } from '../domain/phone';
import { applyProfileFields, toCustomerProfile } from '../mappers/customers.mapper';
import {
  CustomersRepository,
  getCustomersRepository,
  profileWriteFailure,
} from '../repositories/customers.repository';
import { CustomerProfile, CustomerProfileUpdate } from '../types/api-types';
import {
  assertOwnerAdminOrService,
  assertOwnerOrAdmin,
  getUserId,
  isAdminCaller,
} from '../utils';

const baseLogger = createLogger({
  service: 'customers-service',
  redactPII: true,
});

export class CustomersService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CustomersService',
  });

  constructor(
    private readonly repository: CustomersRepository = getCustomersRepository(),
  ) {}

  async getCustomer(request: LambdaRequest): Promise<CustomerProfile> {
    const userId = getUserId(request);
    assertOwnerAdminOrService(request, userId);

    const profile = await this.repository.getProfile(userId);
    if (!profile) {
      throw new NotFoundError('Customer profile not found');
    }

    this.logger.info({
      event: 'get_customer_success',
      userId,
    });

    return toCustomerProfile(profile);
  }

  async putCustomer(request: LambdaRequest): Promise<CustomerProfile> {
    const userId = getUserId(request);
    assertOwnerOrAdmin(request, userId);

    const body = (request.body ?? {}) as CustomerProfileUpdate;
    this.assertPrivilegedFields(request, body);

    const existing = await this.repository.getProfile(userId);
    const now = new Date().toISOString();
    const next = applyProfileFields(
      existing ?? undefined,
      userId,
      {
        ...body,
        email: body.email?.toLowerCase(),
        phone:
          body.phone === null
            ? null
            : body.phone
              ? requireE164(body.phone)
              : undefined,
      },
      now,
    );

    try {
      await this.repository.saveProfile(next, {
        isCreate: !existing,
        previousPhone: existing?.phone,
      });
    } catch (error) {
      const failure = profileWriteFailure(error, !existing);
      if (failure === 'duplicate-profile') {
        throw new ConflictError('Customer profile already exists');
      }
      if (failure === 'missing-profile') {
        throw new NotFoundError('Customer profile not found');
      }
      if (failure === 'phone') {
        throw new ConflictError('Phone number is already in use');
      }
      throw error;
    }

    this.logger.info({
      event: 'put_customer_success',
      userId,
      created: !existing,
    });

    return toCustomerProfile(next);
  }

  private assertPrivilegedFields(
    request: LambdaRequest,
    body: CustomerProfileUpdate,
  ): void {
    if (isAdminCaller(request)) {
      return;
    }

    if (body.status !== undefined || body.loyaltyPoints !== undefined) {
      throw new ForbiddenError(
        'Only an administrator can change status or loyalty points',
      );
    }
  }
}

let service: CustomersService;

export function getCustomersService(): CustomersService {
  if (!service) {
    service = new CustomersService();
  }
  return service;
}
