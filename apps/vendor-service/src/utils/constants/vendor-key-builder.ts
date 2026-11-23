import { OperationalStatus, VendorStatus } from '../../types/api-types';

export const VENDOR_ENTITY_TYPE = 'Vendor' as const;
export const VENDOR_OWNER_ENTITY_TYPE = 'VendorOwner' as const;
export const VENDOR_OWNERSHIP_ENTITY_TYPE = 'VendorOwnership' as const;
export const VENDOR_ADDRESS_ENTITY_TYPE = 'VendorAddress' as const;
export const VENDOR_BANK_ENTITY_TYPE = 'VendorBank' as const;
export const VENDOR_BRANCH_ENTITY_TYPE = 'VendorBranch' as const;
export const VENDOR_DOCUMENT_ENTITY_TYPE = 'VendorDocument' as const;
export const SERVICE_AREA_ENTITY_TYPE = 'ServiceArea' as const;
export const STAFF_ENTITY_TYPE = 'Staff' as const;
export const STAFF_PHONE_ENTITY_TYPE = 'StaffPhone' as const;
export const CREW_ENTITY_TYPE = 'Crew' as const;
export const VENDOR_CAPABILITIES_ENTITY_TYPE = 'VendorCapabilities' as const;
export const VENDOR_OPERATING_PREFERENCES_ENTITY_TYPE = 'VendorOperatingPreferences' as const;
export const VENDOR_INDICATIVE_CAPACITY_ENTITY_TYPE = 'VendorIndicativeCapacity' as const;
export const VENDOR_STATUS_HISTORY_ENTITY_TYPE = 'VendorStatusHistory' as const;
export const VENDOR_COMMUNITY_ENTITY_TYPE = 'VendorCommunity' as const;
export const VENDOR_COVERAGE_HISTORY_ENTITY_TYPE = 'VendorCoverageHistory' as const;
export const CAPACITY_PROPOSAL_ENTITY_TYPE = 'CapacityProposal' as const;
export const CAPACITY_COMMITMENT_ENTITY_TYPE = 'CapacityCommitment' as const;
export const CAPACITY_LEDGER_ENTITY_TYPE = 'CapacityLedger' as const;
export const CAPACITY_LOOKUP_ENTITY_TYPE = 'CapacityLookup' as const;
export const CAPACITY_IDEMPOTENCY_ENTITY_TYPE = 'CapacityIdempotency' as const;
export const PLAN_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE = 'PlanSoldCapacityReservation' as const;
export const VISIT_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE = 'VisitSoldCapacityReservation' as const;
export const COMMITMENT_DAY_SOLD_ENTITY_TYPE = 'CommitmentDaySold' as const;

export const VENDOR_PROFILE_SK = 'PROFILE';
export const VENDOR_OWNER_SK = 'OWNER';
export const VENDOR_OWNERSHIP_SK = 'VENDOR';
export const VENDOR_ADDRESS_SK = 'ADDRESS';
export const VENDOR_BANK_SK = 'BANK';
export const VENDOR_CAPABILITIES_SK = 'CAPABILITIES';
export const VENDOR_OPERATING_PREFERENCES_SK = 'OPERATING_PREFERENCES';
export const VENDOR_INDICATIVE_CAPACITY_SK = 'INDICATIVE_CAPACITY';
export const BRANCH_SK_PREFIX = 'BRANCH#';
export const DOCUMENT_SK_PREFIX = 'DOCUMENT#';
export const SERVICE_AREA_SK_PREFIX = 'SERVICE_AREA#';
export const STAFF_SK_PREFIX = 'STAFF#';
export const STAFF_PHONE_SK_PREFIX = 'STAFF_PHONE#';
export const CREW_SK_PREFIX = 'CREW#';
export const STATUS_HISTORY_SK_PREFIX = 'STATUS_HISTORY#';
export const COMMUNITY_SK_PREFIX = 'COMMUNITY#';
export const BASELINE_CAPACITY_SK_PREFIX = 'BASELINE_CAPACITY#';
export const VENDOR_BASELINE_CAPACITY_ENTITY_TYPE = 'VendorBaselineCapacity' as const;
/** Not prefixed by COMMUNITY# so coverage listings never return history rows. */
export const COVERAGE_HISTORY_SK_PREFIX = 'COVERAGE_HISTORY#';
export const CAPACITY_PROPOSAL_SK_PREFIX = 'CAPACITY_PROPOSAL#';
export const CAPACITY_COMMITMENT_SK_PREFIX = 'CAPACITY_COMMITMENT#';
export const CAPACITY_LEDGER_SK = 'CAPACITY_LEDGER';
export const CAPACITY_LOOKUP_SK = 'LOOKUP';
export const CAPACITY_IDEMPOTENCY_SK = 'RECORD';

export const CAPACITY_PROPOSAL_GSI1_PK = 'CAPACITY_PROPOSAL';
/** Cross-vendor operations list. Distinct from proposal and vendor-status partitions on GSI1. */
export const CAPACITY_COMMITMENT_GSI1_PK = 'CAPACITY_COMMITMENT';

export const VENDOR_GSI1_PK = 'VENDOR';
export const GSI1_INDEX = 'GSI1';
export const GSI2_INDEX = 'GSI2';
export const GSI3_INDEX = 'GSI3';

export const VendorKeyBuilder = {
  vendorPk: (vendorId: string) => `VENDOR#${vendorId}`,

  vendorSk: () => VENDOR_PROFILE_SK,

  ownerSk: () => VENDOR_OWNER_SK,

  addressSk: () => VENDOR_ADDRESS_SK,

  bankSk: () => VENDOR_BANK_SK,

  branchSk: (branchId: string) => `${BRANCH_SK_PREFIX}${branchId}`,

  branchSkPrefix: () => BRANCH_SK_PREFIX,

  documentSk: (documentId: string) => `${DOCUMENT_SK_PREFIX}${documentId}`,

  documentSkPrefix: () => DOCUMENT_SK_PREFIX,

  serviceAreaSk: (serviceAreaId: string) =>
    `${SERVICE_AREA_SK_PREFIX}${serviceAreaId}`,

  serviceAreaSkPrefix: () => SERVICE_AREA_SK_PREFIX,

  staffSk: (staffId: string) => `${STAFF_SK_PREFIX}${staffId}`,

  staffSkPrefix: () => STAFF_SK_PREFIX,

  staffPhoneSk: (phoneNumber: string) => `${STAFF_PHONE_SK_PREFIX}${phoneNumber}`,

  crewSk: (crewId: string) => `${CREW_SK_PREFIX}${crewId}`,

  crewSkPrefix: () => CREW_SK_PREFIX,

  capabilitiesSk: () => VENDOR_CAPABILITIES_SK,

  operatingPreferencesSk: () => VENDOR_OPERATING_PREFERENCES_SK,

  indicativeCapacitySk: () => VENDOR_INDICATIVE_CAPACITY_SK,

  gsi1Pk: () => VENDOR_GSI1_PK,

  gsi1Sk: (
    status: VendorStatus,
    operationalStatus: OperationalStatus,
    createdAt: string,
    vendorId: string,
  ) =>
    `STATUS#${status}#OPERATIONAL#${operationalStatus}#${createdAt}#${vendorId}`,

  /** The only discovery-key format used by vendor PROFILE rows. */
  vendorDiscoveryKeys: (
    status: VendorStatus,
    operationalStatus: OperationalStatus,
    createdAt: string,
    vendorId: string,
  ) => ({
    GSI1PK: VENDOR_GSI1_PK,
    GSI1SK: VendorKeyBuilder.gsi1Sk(status, operationalStatus, createdAt, vendorId),
  }),

  gsi1SkStatusPrefix: (status: VendorStatus) => `STATUS#${status}#`,

  gsi1SkStatusOperationalPrefix: (
    status: VendorStatus,
    operationalStatus: OperationalStatus,
  ) => `STATUS#${status}#OPERATIONAL#${operationalStatus}#`,

  ownerGsi1Pk: (userId: string) => `OWNER#${userId}`,

  ownerGsi1Sk: (vendorId: string) => `VENDOR#${vendorId}`,

  ownerGsi1SkPrefix: () => 'VENDOR#',

  /**
   * Base-table uniqueness key for one vendor application per user.
   * Distinct from the owner item, which keeps GSI1 = OWNER#{userId}.
   */
  ownershipPk: (userId: string) => `OWNER#${userId}`,

  ownershipSk: () => VENDOR_OWNERSHIP_SK,

  normalizeCity: (city: string) => city.trim().toUpperCase(),

  gsi2Pk: (city: string) => `CITY#${VendorKeyBuilder.normalizeCity(city)}`,

  gsi2Sk: (postalCode: string, createdAt: string, vendorId: string) =>
    `POSTAL#${postalCode}#${createdAt}#${vendorId}`,

  gsi2SkPostalPrefix: (postalCode: string) => `POSTAL#${postalCode}#`,

  statusHistorySk: (reviewedAt: string, historyId: string) =>
    `${STATUS_HISTORY_SK_PREFIX}${reviewedAt}#${historyId}`,

  statusHistorySkPrefix: () => STATUS_HISTORY_SK_PREFIX,

  communitySk: (communityId: string) => `${COMMUNITY_SK_PREFIX}${communityId}`,

  communitySkPrefix: () => COMMUNITY_SK_PREFIX,

  baselineCapacitySk: (communityId: string) => `${BASELINE_CAPACITY_SK_PREFIX}${communityId}`,

  baselineCapacitySkPrefix: () => BASELINE_CAPACITY_SK_PREFIX,

  communityGsi3Pk: (communityId: string) => `COMMUNITY#${communityId}`,

  communityGsi3Sk: (status: VendorStatus, vendorId: string) =>
    `STATUS#${status}#VENDOR#${vendorId}`,

  communityGsi3StatusPrefix: (status: VendorStatus) => `STATUS#${status}#`,

  coverageHistorySk: (communityId: string, at: string, historyId: string) =>
    `${COVERAGE_HISTORY_SK_PREFIX}${communityId}#${at}#${historyId}`,

  coverageHistorySkPrefix: (communityId: string) =>
    `${COVERAGE_HISTORY_SK_PREFIX}${communityId}#`,

  // ---- Capacity proposals and commitments -------------------------------

  capacityProposalSk: (proposalId: string) =>
    `${CAPACITY_PROPOSAL_SK_PREFIX}${proposalId}`,

  capacityProposalSkPrefix: () => CAPACITY_PROPOSAL_SK_PREFIX,

  capacityCommitmentSk: (commitmentId: string) =>
    `${CAPACITY_COMMITMENT_SK_PREFIX}${commitmentId}`,

  capacityCommitmentSkPrefix: () => CAPACITY_COMMITMENT_SK_PREFIX,

  /** One row per vendor. Its version serializes concurrent accepts for that vendor. */
  capacityLedgerSk: () => CAPACITY_LEDGER_SK,

  /** Id -> vendor lookup rows (PK = CAPACITY_PROPOSAL#id / CAPACITY_COMMITMENT#id). */
  capacityProposalLookupPk: (proposalId: string) =>
    `${CAPACITY_PROPOSAL_SK_PREFIX}${proposalId}`,

  capacityCommitmentLookupPk: (commitmentId: string) =>
    `${CAPACITY_COMMITMENT_SK_PREFIX}${commitmentId}`,

  capacityLookupSk: () => CAPACITY_LOOKUP_SK,

  capacityIdempotencyPk: (scopeHash: string) => `IDEMPOTENCY#CAPACITY#${scopeHash}`,

  capacityIdempotencySk: () => CAPACITY_IDEMPOTENCY_SK,

  /** One row per paid customer plan; prevents double reserve on payment replay. */
  planSoldCapacityReservationPk: (planId: string) => `PLAN_SOLD_CAPACITY#${planId}`,

  planSoldCapacityReservationSk: () => 'RESERVE',

  /** One row per scheduled package visit sold-capacity debit. */
  visitSoldCapacityReservationPk: (visitId: string) => `VISIT_SOLD_CAPACITY#${visitId}`,

  visitSoldCapacityReservationSk: () => 'RESERVE',

  /** Per commitment service-day sold ledger (under the vendor partition). */
  commitmentDaySoldSk: (commitmentId: string, date: string) =>
    `CAPACITY_DAY_SOLD#${commitmentId}#${date}`,

  /** Cross-vendor admin listing: GSI1 CAPACITY_COMMITMENT / STATUS#<status>#<windowStart>#<id>. */
  capacityCommitmentGsi1Pk: () => CAPACITY_COMMITMENT_GSI1_PK,

  capacityCommitmentGsi1Sk: (status: string, windowStartDate: string, commitmentId: string) =>
    `STATUS#${status}#${windowStartDate}#${commitmentId}`,

  capacityCommitmentGsi1StatusPrefix: (status: string) => `STATUS#${status}#`,

  /** Same community partition as proposals. SK prefix COMMITMENT# keeps the two entities apart. */
  capacityCommitmentGsi3Pk: (communityId: string) => `CAPACITY_COMMUNITY#${communityId}`,

  capacityCommitmentGsi3Sk: (status: string, windowStartDate: string, commitmentId: string) =>
    `COMMITMENT#${status}#${windowStartDate}#${commitmentId}`,

  capacityCommitmentGsi3Prefix: (status?: string) =>
    status ? `COMMITMENT#${status}#` : 'COMMITMENT#',

  /** Cross-vendor admin listing: GSI1 CAPACITY_PROPOSAL / STATUS#<status>#<createdAt>#<id>. */
  capacityProposalGsi1Pk: () => CAPACITY_PROPOSAL_GSI1_PK,

  capacityProposalGsi1Sk: (status: string, createdAt: string, proposalId: string) =>
    `STATUS#${status}#${createdAt}#${proposalId}`,

  capacityProposalGsi1StatusPrefix: (status: string) => `STATUS#${status}#`,

  /** Community listing: GSI3 CAPACITY_COMMUNITY#<id> / PROPOSAL#<createdAt>#<id>. */
  capacityProposalGsi3Pk: (communityId: string) => `CAPACITY_COMMUNITY#${communityId}`,

  capacityProposalGsi3Sk: (createdAt: string, proposalId: string) =>
    `PROPOSAL#${createdAt}#${proposalId}`,
};

/** GSI attributes for GET /ops/capacity-commitments. Not a second commitment record. */
export function capacityCommitmentOpsIndex(input: {
  status: string;
  communityId: string;
  windowStartDate: string;
  commitmentId: string;
}): { GSI1PK: string; GSI1SK: string; GSI3PK: string; GSI3SK: string } {
  return {
    GSI1PK: VendorKeyBuilder.capacityCommitmentGsi1Pk(),
    GSI1SK: VendorKeyBuilder.capacityCommitmentGsi1Sk(
      input.status,
      input.windowStartDate,
      input.commitmentId,
    ),
    GSI3PK: VendorKeyBuilder.capacityCommitmentGsi3Pk(input.communityId),
    GSI3SK: VendorKeyBuilder.capacityCommitmentGsi3Sk(
      input.status,
      input.windowStartDate,
      input.commitmentId,
    ),
  };
}
