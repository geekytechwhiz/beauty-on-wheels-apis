import type { VendorAccountProvisioningRequestedPayload } from '@api-hub/event-platform';
import { getLogger } from '@api-hub/observability';

import { publishVendorAccountProvisioningRequested } from '../../events/publish-vendor-account-provisioning';

export type PublishVendorAccountProvisioning = (
  payload: VendorAccountProvisioningRequestedPayload,
  correlationId: string,
) => Promise<void>;

/**
 * Requests Identity-owned Cognito/user/role provisioning.
 * Publishing is not completion — COMPLETED is applied only on Vendor.AccountProvisioned.
 */
export async function ensureVendorAccountProvisioning(input: {
  vendorId: string;
  loginPhoneNumber: string;
  displayName: string;
  email?: string;
  correlationId: string;
  publish?: PublishVendorAccountProvisioning;
}): Promise<void> {
  const publish = input.publish ?? publishVendorAccountProvisioningRequested;
  const payload: VendorAccountProvisioningRequestedPayload = {
    vendorId: input.vendorId,
    loginPhoneNumber: input.loginPhoneNumber,
    displayName: input.displayName,
    ...(input.email ? { email: input.email } : {}),
  };

  getLogger().info('vendor_account_provisioning_publish_started', {
    vendorId: input.vendorId,
    correlationId: input.correlationId,
    operation: 'vendor.account.provisioning',
  });

  try {
    await publish(payload, input.correlationId);
    getLogger().info('vendor_account_provisioning_publish_succeeded', {
      vendorId: input.vendorId,
      correlationId: input.correlationId,
      operation: 'vendor.account.provisioning',
      outcome: 'accepted',
    });
  } catch (error) {
    getLogger().error('vendor_account_provisioning_publish_failed', error, {
      vendorId: input.vendorId,
      correlationId: input.correlationId,
      operation: 'vendor.account.provisioning',
      outcome: 'failed',
    });
    throw error;
  }
}
