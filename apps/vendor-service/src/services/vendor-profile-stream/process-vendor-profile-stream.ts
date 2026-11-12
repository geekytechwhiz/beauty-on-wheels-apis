import type { VendorEmailVerificationRequestedPayload } from '@api-hub/event-platform';

import type { VendorProfileStreamWorkPayload } from '../../events/vendor-profile-stream.work';
import {
  ensureVendorAccountProvisioning,
  type PublishVendorAccountProvisioning,
} from './ensure-account-provisioning';
import {
  ensureVendorEmailVerificationInitiation,
  type PublishVendorEmailVerification,
} from './ensure-email-verification';

export type ProcessVendorProfileStreamDeps = {
  publishProvisioning?: PublishVendorAccountProvisioning;
  publishEmail?: PublishVendorEmailVerification;
  markEmailDispatched?: (
    vendorId: string,
    verificationRequestId: string,
  ) => Promise<void>;
};

/**
 * Coordinates post-create PROFILE stream work. Account provisioning is requested
 * before email so a later email failure never undoes Cognito/user/role work.
 */
export async function processVendorProfileStreamWork(
  work: VendorProfileStreamWorkPayload & { correlationId: string },
  deps: ProcessVendorProfileStreamDeps = {},
): Promise<void> {
  if (work.needsAccountProvisioning && work.provisioning) {
    await ensureVendorAccountProvisioning({
      vendorId: work.vendorId,
      loginPhoneNumber: work.provisioning.loginPhoneNumber,
      displayName: work.provisioning.displayName,
      email: work.provisioning.email,
      correlationId: work.correlationId,
      publish: deps.publishProvisioning,
    });
  }

  if (work.needsEmailVerification && work.emailVerification) {
    await ensureVendorEmailVerificationInitiation({
      payload: work.emailVerification as VendorEmailVerificationRequestedPayload,
      correlationId: work.correlationId,
      publish: deps.publishEmail,
      markDispatched: deps.markEmailDispatched,
    });
  }
}
