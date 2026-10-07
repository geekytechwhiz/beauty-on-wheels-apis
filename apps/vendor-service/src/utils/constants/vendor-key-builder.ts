import { OperationalStatus, VendorStatus } from '../../types/api-types';

export const VENDOR_ENTITY_TYPE = 'Vendor' as const;
export const VENDOR_OWNER_ENTITY_TYPE = 'VendorOwner' as const;
export const VENDOR_ADDRESS_ENTITY_TYPE = 'VendorAddress' as const;
export const VENDOR_BANK_ENTITY_TYPE = 'VendorBank' as const;
export const VENDOR_BRANCH_ENTITY_TYPE = 'VendorBranch' as const;
export const VENDOR_DOCUMENT_ENTITY_TYPE = 'VendorDocument' as const;
export const SERVICE_AREA_ENTITY_TYPE = 'ServiceArea' as const;
export const STAFF_ENTITY_TYPE = 'Staff' as const;
export const VENDOR_CAPABILITIES_ENTITY_TYPE = 'VendorCapabilities' as const;
export const VENDOR_OPERATING_HOURS_ENTITY_TYPE = 'VendorOperatingHours' as const;
export const VENDOR_STATUS_HISTORY_ENTITY_TYPE = 'VendorStatusHistory' as const;
export const VENDOR_COMMUNITY_ENTITY_TYPE = 'VendorCommunity' as const;

export const VENDOR_PROFILE_SK = 'PROFILE';
export const VENDOR_OWNER_SK = 'OWNER';
export const VENDOR_ADDRESS_SK = 'ADDRESS';
export const VENDOR_BANK_SK = 'BANK';
export const VENDOR_CAPABILITIES_SK = 'CAPABILITIES';
export const VENDOR_OPERATING_HOURS_SK = 'HOURS';
export const BRANCH_SK_PREFIX = 'BRANCH#';
export const DOCUMENT_SK_PREFIX = 'DOCUMENT#';
export const SERVICE_AREA_SK_PREFIX = 'SERVICE_AREA#';
export const STAFF_SK_PREFIX = 'STAFF#';
export const STATUS_HISTORY_SK_PREFIX = 'STATUS_HISTORY#';
export const COMMUNITY_SK_PREFIX = 'COMMUNITY#';

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

  capabilitiesSk: () => VENDOR_CAPABILITIES_SK,

  operatingHoursSk: () => VENDOR_OPERATING_HOURS_SK,

  gsi1Pk: () => VENDOR_GSI1_PK,

  gsi1Sk: (
    status: VendorStatus,
    operationalStatus: OperationalStatus,
    createdAt: string,
    vendorId: string,
  ) =>
    `STATUS#${status}#OPERATIONAL#${operationalStatus}#${createdAt}#${vendorId}`,

  gsi1SkStatusPrefix: (status: VendorStatus) => `STATUS#${status}#`,

  gsi1SkStatusOperationalPrefix: (
    status: VendorStatus,
    operationalStatus: OperationalStatus,
  ) => `STATUS#${status}#OPERATIONAL#${operationalStatus}#`,

  ownerGsi1Pk: (userId: string) => `OWNER#${userId}`,

  ownerGsi1Sk: (vendorId: string) => `VENDOR#${vendorId}`,

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

  communityGsi3Pk: (communityId: string) => `COMMUNITY#${communityId}`,

  communityGsi3Sk: (status: VendorStatus, vendorId: string) =>
    `STATUS#${status}#VENDOR#${vendorId}`,

  communityGsi3StatusPrefix: (status: VendorStatus) => `STATUS#${status}#`,
};
