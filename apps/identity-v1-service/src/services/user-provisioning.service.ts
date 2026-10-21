import {
  publishEvent,
  IdentityRegisteredEvent,
  identityRegisteredIdempotencyKey,
  type IdentityRegisteredPayload,
} from '@api-hub/event-platform';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { ensureIdentityEventPlatform } from '../events/configure-identity-event-platform';
import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';

const baseLogger = createLogger({
  service: 'identity-user-provisioning',
  redactPII: true,
});

export class UserProvisioningService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'UserProvisioningService',
  });

  constructor(
    private readonly repository: IdentityRepository = identityRepositoryInstance,
  ) {}

  async publishRegistration(
    identityId: string,
    correlationId: string,
  ): Promise<boolean> {
    try {
      ensureIdentityEventPlatform();
      const identity = await this.repository.getUserByIdentityId(identityId);

      if (!identity) return false;
      const payload: IdentityRegisteredPayload = {
        identityId,
        userId: identity.userId,
        phoneVerified: identity.phoneVerified,
        ...(identity.emailVerified ? { emailVerified: true } : {}),
        ...(identity.phoneVerified && identity.phoneNumber
          ? { phone: identity.phoneNumber }
          : {}),
        ...(identity.emailVerified && identity.email
          ? { email: identity.email }
          : {}),
      };
      this.logger.info({
        event: 'publishRegistration_payload',
        identityId,
        payload,
      });
      await publishEvent(IdentityRegisteredEvent, payload, {
        idempotencyKey: identityRegisteredIdempotencyKey(identityId),
        meta: { correlationId },
      });
      this.logger.info({
        event: 'identity_registration_event_published',
        identityId,
        correlationId,
        provisioningStatus: 'PENDING',
      });
      return true;
    } catch (error) {
      this.logger.error({
        event: 'publishRegistration_error',
        error,
        identityId,
        correlationId,
      });
      return false;
    }
  }

  async linkUser(
    identityId: string,
    userId: string,
  ): Promise<'linked' | 'already-linked'> {
    return this.repository.linkProvisionedUser(identityId, userId);
  }

  async reconcilePending(): Promise<{ scanned: number; republished: number }> {
    const cursor = await this.repository.getProvisioningReconciliationCursor();
    const page = await this.repository.listUserMetaPage(cursor);
    let republished = 0;
    for (const identity of page.users) {
      const profile = await this.repository.getProfile(identity.userId);
      if (
        profile?.userProvisioning?.status === 'PENDING' &&
        profile.identityId &&
        (await this.publishRegistration(
          profile.identityId,
          `reconciliation:${profile.identityId}`,
        ))
      )
        republished += 1;
    }
    // Advance only after every page event is accepted. A crash or publishing
    // failure replays the page; the user mapping makes that safe.
    await this.repository.saveProvisioningReconciliationCursor(
      page.lastEvaluatedKey,
    );
    this.logger.info({
      event: 'user_provisioning_reconciliation',
      scanned: page.users.length,
      republished,
    });
    return { scanned: page.users.length, republished };
  }
}

let service: UserProvisioningService;
export function getUserProvisioningService(): UserProvisioningService {
  if (!service) service = new UserProvisioningService();
  return service;
}
