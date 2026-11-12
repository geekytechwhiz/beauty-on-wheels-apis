import { type CognitoAuthClient, getCognitoAuthClient } from '@api-hub/authentication-core';
import type { VendorAccountProvisioningRequestedPayload } from '@api-hub/event-platform';
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
  service: 'identity-vendor-account-provisioning',
  redactPII: true,
});

type RegistrationPort = {
  createIdentity(input: CreateIdentityInput): Promise<User>;
};

type AuthenticationPort = {
  ensureCognitoLink(user: User): Promise<User>;
};

/**
 * Trusted server-side provisioning for staff-created vendor login accounts.
 * Role is deliberately absent from the inbound event; VENDOR is assigned here.
 */
export class VendorAccountProvisioningService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'VendorAccountProvisioningService',
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
    input: VendorAccountProvisioningRequestedPayload,
  ): Promise<{ identityId: string; userId: string }> {
    // Event schemas perform this validation at the handler boundary.  Keep it
    // here too because this service is also invoked directly by tests and
    // future trusted consumers; no Cognito or Identity mutation may precede it.
    if (!input.vendorId?.trim()) {
      throw new Error('vendorId is required for vendor account provisioning');
    }
    const phoneNumber = IdentityKeyBuilder.normalizePhone(
      input.loginPhoneNumber.trim(),
    );
    this.logger.info({
      event: 'vendor_account_provisioning_started',
      vendorId: input.vendorId,
      operation: 'identity.vendor.account.provisioning',
    });

    let user = await this.repository.getUserByPhone(phoneNumber);
    if (!user) {
      const cognito = await this.cognito.findOrCreateUser({
        phoneNumber,
        email: input.email,
      });
      try {
        // vendorRegistration => initial ROLE#VENDOR only (not CUSTOMER).
        // Existing CUSTOMER accounts take the reuse path above.
        user = await this.registration.createIdentity({
          phoneNumber,
          firstName: input.displayName,
          identityId: cognito.sub,
          cognitoUsername: cognito.username,
          userType: 'VENDOR',
          vendorRegistration: true,
          email: input.email,
          // Staff entry is not proof of channel verification.
          phoneVerified: false,
          emailVerified: false,
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
    await this.repository.ensureVendorRoleMapping(user.userId, input.vendorId);

    if (!user.identityId) {
      throw new Error('Vendor provisioning completed without identityId');
    }

    this.logger.info({
      event: 'vendor_account_provisioning_completed',
      vendorId: input.vendorId,
      operation: 'identity.vendor.account.provisioning',
      outcome: 'completed',
    });

    return { identityId: user.identityId, userId: user.userId };
  }
}
