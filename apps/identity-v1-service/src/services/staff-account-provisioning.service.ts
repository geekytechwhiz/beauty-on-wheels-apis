import { type CognitoAuthClient, getCognitoAuthClient, APPLICATION_ROLE } from '@api-hub/authentication-core';
import type { StaffAccountProvisioningRequestedPayload } from '@api-hub/event-platform';
import { IdentityKeyBuilder } from '../keys/identity-key.builder';
import { IdentityRepository, identityRepositoryInstance } from '../repositories/identity.repository';
import { AuthenticationService } from './authentication.service';
import { RegistrationService } from './registration.service';

/** Identity-owned, retry-safe provisioning for a vendor staff membership. */
export class StaffAccountProvisioningService {
  constructor(
    private readonly repository: IdentityRepository = identityRepositoryInstance,
    private readonly cognito: CognitoAuthClient = getCognitoAuthClient(),
  ) {}

  async ensure(input: StaffAccountProvisioningRequestedPayload): Promise<{ identityId: string; userId: string }> {
    const phoneNumber = IdentityKeyBuilder.normalizePhone(input.phoneNumber);
    let user = await this.repository.getUserByPhone(phoneNumber);
    if (!user) {
      const cognito = await this.cognito.findOrCreateUser({ phoneNumber });
      try {
        user = await new RegistrationService(this.repository).createIdentity({
          phoneNumber, firstName: input.displayName, identityId: cognito.sub,
          cognitoUsername: cognito.username, userType: 'CUSTOMER', phoneVerified: false,
        });
      } catch (error) {
        user = await this.repository.getUserByPhone(phoneNumber);
        if (!user) throw error;
      }
    }
    user = await new AuthenticationService(this.repository, this.cognito).ensureCognitoLink(user);
    await this.repository.ensureUserRoleMapping(user.userId, APPLICATION_ROLE.STAFF);
    if (!user.identityId) throw new Error('Staff provisioning completed without identityId');
    return { identityId: user.identityId, userId: user.userId };
  }
}
