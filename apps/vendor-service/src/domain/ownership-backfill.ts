import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

/** Identity Service application user ids. Cognito subs and generated ids do not match. */
export const CANONICAL_USER_ID =
  /^u-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Client-generated owner ids persisted from onboarding OWNER_DETAILS bodies. */
export const GENERATED_OWNER_ID = /^user_\d+$/;

export function isCanonicalUserId(value: string | undefined): value is string {
  return typeof value === 'string' && CANONICAL_USER_ID.test(value.trim());
}

export interface VendorOwnershipSnapshot {
  vendorId: string;
  profileOwnerUserId?: string;
  ownerItemUserId?: string;
  ownerGsi1Pk?: string;
  hasOwnerItem: boolean;
  /** Present for operators. Never used to decide ownership. */
  unverifiedPhoneNumber?: string;
}

export interface VerifiedOwnershipMapping {
  vendorId: string;
  canonicalUserId: string;
  verified: boolean;
}

export type OwnershipRepairAction =
  | 'unchanged'
  | 'realign_index'
  | 'apply_verified_mapping'
  | 'ensure_ownership_lock'
  | 'manual_reconciliation';

export interface OwnershipRepairPlan {
  vendorId: string;
  action: OwnershipRepairAction;
  reason: string;
  canonicalUserId?: string;
  expectedProfileOwnerUserId?: string;
  writeOwnerItem: boolean;
  updateProfileOwnerUserId: boolean;
  before: {
    profileOwnerUserId?: string;
    ownerItemUserId?: string;
    ownerGsi1Pk?: string;
  };
  /** Copied for operators. Never used to choose an owner. */
  unverifiedPhoneNumber?: string;
}

export function planOwnershipRepair(
  snapshot: VendorOwnershipSnapshot,
  options: {
    verifiedMappings?: VerifiedOwnershipMapping[];
    ownershipLockVendorId?: string;
    duplicateCanonicalOwner?: boolean;
  } = {},
): OwnershipRepairPlan {
  const before = {
    profileOwnerUserId: snapshot.profileOwnerUserId,
    ownerItemUserId: snapshot.ownerItemUserId,
    ownerGsi1Pk: snapshot.ownerGsi1Pk,
  };
  const base = {
    vendorId: snapshot.vendorId,
    before,
    writeOwnerItem: false,
    updateProfileOwnerUserId: false,
    unverifiedPhoneNumber: snapshot.unverifiedPhoneNumber,
  };

  const mapping = (options.verifiedMappings ?? []).find(
    (entry) => entry.vendorId === snapshot.vendorId,
  );
  if (mapping && !mapping.verified) {
    return {
      ...base,
      action: 'manual_reconciliation',
      reason:
        'Mapping entry is not marked verified. Ownership was not changed.',
    };
  }
  if (mapping && !isCanonicalUserId(mapping.canonicalUserId)) {
    return {
      ...base,
      action: 'manual_reconciliation',
      reason:
        'Verified mapping canonicalUserId is not an application user id (u-<uuid>).',
    };
  }

  const profileId = snapshot.profileOwnerUserId?.trim();
  const profileIsCanonical = isCanonicalUserId(profileId);
  if (
    mapping &&
    profileIsCanonical &&
    profileId !== mapping.canonicalUserId.trim()
  ) {
    return {
      ...base,
      action: 'manual_reconciliation',
      reason:
        'Profile already stores a different canonical user id. The verified mapping was not applied.',
    };
  }

  if (options.duplicateCanonicalOwner) {
    return {
      ...base,
      action: 'manual_reconciliation',
      reason:
        'More than one vendor profile shares this canonical ownerUserId. No ownership lock was written.',
    };
  }

  if (
    options.ownershipLockVendorId &&
    options.ownershipLockVendorId !== snapshot.vendorId
  ) {
    return {
      ...base,
      action: 'manual_reconciliation',
      reason:
        'An ownership lock already points at a different vendor. This record was left unchanged.',
    };
  }

  const targetUserId = mapping
    ? mapping.canonicalUserId.trim()
    : profileIsCanonical
      ? profileId
      : undefined;

  if (!targetUserId) {
    return {
      ...base,
      action: 'manual_reconciliation',
      reason: nonCanonicalReason(snapshot),
    };
  }

  const expectedGsi = VendorKeyBuilder.ownerGsi1Pk(targetUserId);
  const ownerAligned =
    snapshot.hasOwnerItem &&
    snapshot.ownerItemUserId === targetUserId &&
    snapshot.ownerGsi1Pk === expectedGsi;
  const profileAligned = profileId === targetUserId;
  const lockAligned = options.ownershipLockVendorId === snapshot.vendorId;

  if (profileAligned && ownerAligned && lockAligned) {
    return {
      ...base,
      action: 'unchanged',
      reason: 'Profile, owner GSI1 key, and ownership lock already match.',
      canonicalUserId: targetUserId,
    };
  }

  if (mapping) {
    return {
      ...base,
      action: 'apply_verified_mapping',
      reason:
        'Applying an operator-verified vendorId to application userId mapping. Phone numbers were not used.',
      canonicalUserId: targetUserId,
      expectedProfileOwnerUserId: profileId,
      writeOwnerItem: true,
      updateProfileOwnerUserId: !profileAligned,
    };
  }

  if (profileAligned && ownerAligned && !lockAligned) {
    return {
      ...base,
      action: 'ensure_ownership_lock',
      reason:
        'Canonical owner is already indexed. Adding the missing ownership lock.',
      canonicalUserId: targetUserId,
      writeOwnerItem: false,
      updateProfileOwnerUserId: false,
    };
  }

  return {
    ...base,
    action: 'realign_index',
    reason:
      'Profile ownerUserId is already the application user id. Owner item GSI1 is realigned to that id. The previous owner key was not treated as proof of a different user.',
    canonicalUserId: targetUserId,
    expectedProfileOwnerUserId: profileId,
    writeOwnerItem: true,
    updateProfileOwnerUserId: false,
  };
}

function nonCanonicalReason(snapshot: VendorOwnershipSnapshot): string {
  const profileId = snapshot.profileOwnerUserId?.trim() ?? '';
  const ownerId = snapshot.ownerItemUserId?.trim() ?? '';
  const generated =
    GENERATED_OWNER_ID.test(profileId) || GENERATED_OWNER_ID.test(ownerId);
  if (generated) {
    return 'Owner id was generated (user_<timestamp>) and the profile has no canonical application user id. Manual reconciliation is required. Phone number was not used.';
  }
  return 'Neither the profile ownerUserId nor a verified mapping is a canonical application user id. Manual reconciliation is required. Phone number was not used.';
}

export interface OwnershipRepairWrite {
  plan: OwnershipRepairPlan;
  ownershipItem: {
    PK: string;
    SK: string;
    vendorId: string;
    ownerUserId: string;
    entityType: 'VendorOwnership';
    createdAt: string;
    updatedAt: string;
  };
  ownerKey: { PK: string; SK: string };
  profileKey: { PK: string; SK: string };
  gsi1pk: string;
  gsi1sk: string;
}

export function buildOwnershipRepairWrite(
  snapshot: VendorOwnershipSnapshot,
  plan: OwnershipRepairPlan,
  now: string,
): OwnershipRepairWrite | null {
  if (
    plan.action === 'unchanged' ||
    plan.action === 'manual_reconciliation' ||
    !plan.canonicalUserId
  ) {
    return null;
  }

  return {
    plan,
    ownershipItem: {
      PK: VendorKeyBuilder.ownershipPk(plan.canonicalUserId),
      SK: VendorKeyBuilder.ownershipSk(),
      vendorId: snapshot.vendorId,
      ownerUserId: plan.canonicalUserId,
      entityType: 'VendorOwnership',
      createdAt: now,
      updatedAt: now,
    },
    ownerKey: {
      PK: VendorKeyBuilder.vendorPk(snapshot.vendorId),
      SK: VendorKeyBuilder.ownerSk(),
    },
    profileKey: {
      PK: VendorKeyBuilder.vendorPk(snapshot.vendorId),
      SK: VendorKeyBuilder.vendorSk(),
    },
    gsi1pk: VendorKeyBuilder.ownerGsi1Pk(plan.canonicalUserId),
    gsi1sk: VendorKeyBuilder.ownerGsi1Sk(snapshot.vendorId),
  };
}
