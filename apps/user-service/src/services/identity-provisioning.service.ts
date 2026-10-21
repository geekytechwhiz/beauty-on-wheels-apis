import { createChildLogger, createLogger } from '@api-hub/observability';
import { ConditionalWriteConflictError } from '@api-hub/utils';

import { ENTITY_TYPE, USER_STATUS } from '../domain/constants';
import {
  CustomersRepository,
  getCustomersRepository,
} from '../repositories/customers.repository';
import { CustomerProfileRecord } from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

const baseLogger = createLogger({ service: 'user-provisioning-service', redactPII: true });

export type EnsureUserForIdentityInput = {
  identityId: string;
  userId: string;
  phone?: string;
  email?: string;
};

export type EnsureUserForIdentityResult = {
  identityId: string;
  userId: string;
  created: boolean;
};

/** Owns only User Service state; Identity Service never writes this table. */
export class IdentityProvisioningService {
  private readonly logger = createChildLogger(baseLogger, { service: 'IdentityProvisioningService' });

  constructor(
    private readonly repository: CustomersRepository = getCustomersRepository(),
  ) {}

  async ensureUserForIdentity(
    input: EnsureUserForIdentityInput,
  ): Promise<EnsureUserForIdentityResult> {
    const identityId = input.identityId.trim();
    const existing = await this.repository.getIdentityLookup(identityId);
    if (existing) {
      this.logger.info({ event: 'user_provisioning_existing_user', identityId, userId: existing.userId });
      return { identityId, userId: existing.userId, created: false };
    }

    const now = new Date().toISOString();
    // Preserve the established cross-service subject id: authorizers and
    // Vendor ownership already use Identity's userId as the application user.
    const userId = input.userId.trim();
    const profile: CustomerProfileRecord = withoutUndefined({
      PK: UserKeyBuilder.userPk(userId),
      SK: UserKeyBuilder.profileSk(),
      entityType: ENTITY_TYPE.CUSTOMER_PROFILE,
      userId,
      status: USER_STATUS.ACTIVE,
      communityIds: [],
      createdAt: now,
      updatedAt: now,
      email: input.email?.trim().toLowerCase(),
      phone: input.phone?.trim(),
    });

    try {
      await this.repository.createProvisionedUser(profile, identityId);
      this.logger.info({ event: 'user_provisioning_created', identityId, userId });
      return { identityId, userId, created: true };
    } catch (error) {
      // A competing transaction won.  Reading the mapping after the failed
      // conditional transaction is safe and turns at-least-once delivery into
      // one durable application user.
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.repository.getIdentityLookup(identityId);
        if (raced) {
          this.logger.info({ event: 'user_provisioning_existing_user', identityId, userId: raced.userId });
          return { identityId, userId: raced.userId, created: false };
        }
      }
      this.logger.error({ event: 'user_provisioning_failed', identityId, errorCode: error instanceof Error ? error.name : 'UNKNOWN' });
      throw error;
    }
  }
}

let service: IdentityProvisioningService;
export function getIdentityProvisioningService(): IdentityProvisioningService {
  if (!service) service = new IdentityProvisioningService();
  return service;
}
