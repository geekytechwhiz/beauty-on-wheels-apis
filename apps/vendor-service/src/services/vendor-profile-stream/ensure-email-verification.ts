import type { VendorEmailVerificationRequestedPayload } from '@api-hub/event-platform';
import { getLogger } from '@api-hub/observability';

import {
  markVendorEmailVerificationDispatched,
  publishVendorEmailVerificationRequested,
} from '../../events/publish-vendor-email-verification';

export type PublishVendorEmailVerification = (
  payload: VendorEmailVerificationRequestedPayload,
  correlationId: string,
) => Promise<void>;

/**
 * Publishes VendorEmailVerification.Requested and acknowledges dispatch.
 * Failures must not roll back account provisioning; callers should run
 * provisioning first and let stream retry re-drive email only.
 */
export async function ensureVendorEmailVerificationInitiation(input: {
  payload: VendorEmailVerificationRequestedPayload;
  correlationId: string;
  publish?: PublishVendorEmailVerification;
  markDispatched?: (
    vendorId: string,
    verificationRequestId: string,
  ) => Promise<void>;
}): Promise<void> {
  const publish = input.publish ?? publishVendorEmailVerificationRequested;
  const markDispatched =
    input.markDispatched ?? markVendorEmailVerificationDispatched;
  const fields = {
    vendorId: input.payload.vendorId,
    correlationId: input.correlationId,
    operation: 'vendor.email.verification',
    eventName: 'VendorEmailVerification.Requested',
  };

  getLogger().info('vendor_email_event_publish_started', fields);
  try {
    await publish(input.payload, input.correlationId);
    await markDispatched(
      input.payload.vendorId,
      input.payload.verificationRequestId,
    );
    getLogger().info('vendor_email_event_publish_succeeded', {
      ...fields,
      outcome: 'accepted',
    });
  } catch (error) {
    getLogger().error('vendor_email_event_publish_failed', error, {
      ...fields,
      outcome: 'failed',
    });
    throw error;
  }
}
