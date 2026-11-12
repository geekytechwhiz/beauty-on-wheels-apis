/**
 * Processing rules for the single vendor-table PROFILE stream consumer.
 *
 * - PROFILE INSERT: initiate account provisioning when loginPhoneNumber is set
 *   and provisioning is not already COMPLETED.
 * - Deliberate retry MODIFY: accountProvisioningRetryRequestedAt changed while
 *   status is PENDING or FAILED (recovery/tooling only — not every profile edit).
 * - Email verification: persisted OTP request transition (INSERT or MODIFY).
 * - Linkage/status-only MODIFY (identityId, COMPLETED, ownerUserId): no restart.
 * - Unrelated entities and REMOVE: ignore.
 */

export type VendorProfileStreamImages = {
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE' | string;
  oldImage?: Record<string, unknown>;
  newImage?: Record<string, unknown>;
};

export function isVendorProfileRecord(
  image: Record<string, unknown> | undefined,
): boolean {
  return Boolean(
    image &&
      image.entityType === 'Vendor' &&
      image.SK === 'PROFILE',
  );
}

export function shouldInitiateAccountProvisioning(
  input: VendorProfileStreamImages,
): boolean {
  const { eventName, oldImage, newImage } = input;
  if (!isVendorProfileRecord(newImage)) {
    return false;
  }
  if (eventName === 'REMOVE') {
    return false;
  }

  const loginPhone = String(newImage?.loginPhoneNumber ?? '').trim();
  if (!loginPhone) {
    return false;
  }

  const status = String(newImage?.accountProvisioningStatus ?? '');
  if (status === 'COMPLETED' && String(newImage?.identityId ?? '').trim()) {
    return false;
  }

  if (eventName === 'INSERT') {
    return status === 'PENDING' || status === 'FAILED' || status === '';
  }

  if (eventName !== 'MODIFY') {
    return false;
  }

  // Deliberate retry only: recovery tooling bumps this token.
  const newRetry = newImage?.accountProvisioningRetryRequestedAt;
  const oldRetry = oldImage?.accountProvisioningRetryRequestedAt;
  if (
    typeof newRetry === 'string' &&
    newRetry.trim() &&
    newRetry !== oldRetry &&
    (status === 'PENDING' || status === 'FAILED' || status === '')
  ) {
    return true;
  }

  return false;
}

export function displayNameFromVendorProfile(
  image: Record<string, unknown>,
): string {
  const contact = String(image.contactName ?? '').trim();
  if (contact) {
    return contact;
  }
  const business = String(image.businessName ?? '').trim();
  if (business) {
    return business;
  }
  return 'Vendor';
}
