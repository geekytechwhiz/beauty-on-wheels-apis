import { type CognitoAuthClient, getCognitoAuthClient, APPLICATION_ROLE } from '@api-hub/authentication-core';
import type { StaffAccountProvisioningRequestedPayload } from '@api-hub/event-platform';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { IdentityKeyBuilder } from '../keys/identity-key.builder';
import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';
import type { User } from '../types/repository.types';
import { AuthenticationService } from './authentication.service';
import {
  RegistrationService,
  type CreateIdentityInput,
} from './registration.service';

const baseLogger = createLogger({
  service: 'identity-staff-account-provisioning',
  redactPII: true,
});

type RegistrationPort = {
  createIdentity(input: CreateIdentityInput): Promise<User>;
};

type AuthenticationPort = {
  ensureCognitoLink(user: User): Promise<User>;
};

/**
 * Identity-owned, retry-safe provisioning for a partner team membership.
 * Role is deliberately absent from the inbound event; BUDDY is assigned here.
 * Email is optional and never required — Cognito and identity are phone-first.
 */
export class StaffAccountProvisioningService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'StaffAccountProvisioningService',
  });
  private readonly registration: RegistrationPort;
  private readonly authentication: AuthenticationPort;

  constructor(
    private readonly repository: IdentityRepository = identityRepositoryInstance,
    private readonly cognito: CognitoAuthClient = getCognitoAuthClient(),
    registration?: RegistrationPort,
    authentication?: AuthenticationPort,
  ) {
    this.registration = registration ?? new RegistrationService(repository);
    this.authentication =
      authentication ?? new AuthenticationService(repository, cognito);
  }

  async ensure(
    input: StaffAccountProvisioningRequestedPayload,
  ): Promise<{ identityId: string; userId: string }> {
    if (!input.vendorId?.trim()) {
      throw new Error('vendorId is required for staff account provisioning');
    }
    if (!input.staffId?.trim()) {
      throw new Error('staffId is required for staff account provisioning');
    }

    const phoneNumber = IdentityKeyBuilder.normalizePhone(input.phoneNumber);
    this.logger.info({
      event: 'staff_account_provisioning_started',
      vendorId: input.vendorId,
      staffId: input.staffId,
      operation: 'identity.staff.account.provisioning',
    });

    let user = await this.repository.getUserByPhone(phoneNumber);
    if (!user) {
      // Phone-only Cognito create — email stays omitted for OTP mobile login.
      const cognito = await this.cognito.findOrCreateUser({ phoneNumber });
      try {
        user = await this.registration.createIdentity({
          phoneNumber,
          firstName: input.displayName,
          identityId: cognito.sub,
          cognitoUsername: cognito.username,
          userType: 'CUSTOMER',
          phoneVerified: false,
        });
      } catch (error) {
        // Phone uniqueness transaction is the concurrency gate. A concurrent
        // request can win after Cognito is created; reuse its durable identity.
        user = await this.repository.getUserByPhone(phoneNumber);
        if (!user) {
          throw error;
        }
      }
    }

    user = await this.authentication.ensureCognitoLink(user);
    // Additive BUDDY grant. Never replaces CUSTOMER/VENDOR/STAFF or rewrites
    // an existing user's name/profile — reuse path only adds the role mapping.
    await this.repository.ensureUserRoleMapping(
      user.userId,
      APPLICATION_ROLE.BUDDY,
    );

    if (!user.identityId) {
      throw new Error('Staff provisioning completed without identityId');
    }

    this.logger.info({
      event: 'staff_account_provisioning_completed',
      vendorId: input.vendorId,
      staffId: input.staffId,
      operation: 'identity.staff.account.provisioning',
      outcome: 'completed',
    });

    return { identityId: user.identityId, userId: user.userId };
  }
}
