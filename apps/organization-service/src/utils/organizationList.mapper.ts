import type { Organization } from '../models/Organization';

/** Maps a sanitized org record to the list API response shape. */
export function mapOrganizationListItem(item: Organization): Record<string, unknown> {
  const transformed: Record<string, unknown> = {};
  const record = item as Organization & Record<string, unknown>;
  let orgInfoForSearch: Record<string, unknown> | undefined;

  if (record.organizationInfo && typeof record.organizationInfo === 'object') {
    transformed.organizationInfo = { ...(record.organizationInfo as Record<string, unknown>) };
    const orgInfo = transformed.organizationInfo as Record<string, unknown>;
    if (orgInfo.organizationName && !orgInfo.name) orgInfo.name = orgInfo.organizationName;
    if (!orgInfo.organizationID && item.organizationId) orgInfo.organizationID = item.organizationId;
    mergeAddress(orgInfo, record);
    if (!orgInfo.organizationName && item.name) orgInfo.organizationName = item.name;
    if (!orgInfo.name && item.name) orgInfo.name = item.name;
    if (!orgInfo.organizationType && item.organizationType) orgInfo.organizationType = item.organizationType;
    if (!orgInfo.phoneCode && item.phoneCode) orgInfo.phoneCode = item.phoneCode;
    if (!orgInfo.phoneNumber && item.phoneNumber) orgInfo.phoneNumber = item.phoneNumber;
    if (!orgInfo.emailAddress && item.email) orgInfo.emailAddress = item.email;
    if (item.hospitalBio !== undefined && orgInfo.hospitalBio === undefined) orgInfo.hospitalBio = item.hospitalBio;
    if (item.hospitalImage && !orgInfo.hospitalImage) orgInfo.hospitalImage = item.hospitalImage;
    orgInfoForSearch = orgInfo;
  } else {
    const orgInfo: Record<string, unknown> = {
      organizationID: item.organizationId,
      organizationName: item.name,
      name: item.name,
    };
    if (item.organizationType) orgInfo.organizationType = item.organizationType;
    if (item.phoneCode) orgInfo.phoneCode = item.phoneCode;
    if (item.phoneNumber) orgInfo.phoneNumber = item.phoneNumber;
    if (item.email) orgInfo.emailAddress = item.email;
    if (item.hospitalBio !== undefined) orgInfo.hospitalBio = item.hospitalBio;
    if (item.hospitalImage) orgInfo.hospitalImage = item.hospitalImage;
    mergeAddress(orgInfo, record);
    transformed.organizationInfo = orgInfo;
    orgInfoForSearch = orgInfo;
  }

  const listSearchFields = buildListSearchFields(orgInfoForSearch, record);
  if (Object.keys(listSearchFields).length > 0) {
    transformed.searchFields = listSearchFields;
  }

  transformed.status = item.status;

  if (item.adminDetails) {
    if (Array.isArray(item.adminDetails) && item.adminDetails.length > 0) {
      transformed.adminDetails = item.adminDetails[0];
    } else if (!Array.isArray(item.adminDetails)) {
      transformed.adminDetails = item.adminDetails;
    }
  }

  if (item.createdAt || item.createdDate) {
    transformed.createdAt = item.createdAt || item.createdDate;
  }

  if (record.formAlert !== undefined) {
    transformed.formAlert = record.formAlert;
  }

  return transformed;
}

function mergeAddress(
  orgInfo: Record<string, unknown>,
  item: Record<string, unknown>,
): void {
  if (!orgInfo.address || typeof orgInfo.address !== 'object') {
    const addressObj = buildAddressFromFlat(item);
    if (Object.keys(addressObj).length > 0) orgInfo.address = addressObj;
    return;
  }

  const existingAddress = orgInfo.address as Record<string, unknown>;
  if (item.country && !existingAddress.country) existingAddress.country = item.country;
  if (item.address && !existingAddress.address) existingAddress.address = item.address;
  if (item.state && !existingAddress.state) existingAddress.state = item.state;
  if (item.city && !existingAddress.city) existingAddress.city = item.city;
  if (item.postalCode && !existingAddress.postalCode) existingAddress.postalCode = item.postalCode;
  if (item.countryCode && !existingAddress.countryCode) existingAddress.countryCode = item.countryCode;
}

/** FE org list type filter reads searchFields.organizationType (lowercase). */
function buildListSearchFields(
  orgInfo: Record<string, unknown> | undefined,
  item: Record<string, unknown>,
): Record<string, string> {
  const rawType = orgInfo?.organizationType ?? item.organizationType;
  if (rawType == null || String(rawType).trim() === '') {
    return {};
  }
  return {
    organizationType: String(rawType).toLowerCase(),
  };
}

function buildAddressFromFlat(item: Record<string, unknown>): Record<string, unknown> {
  const addressObj: Record<string, unknown> = {};
  if (item.country) addressObj.country = item.country;
  if (item.address) addressObj.address = item.address;
  if (item.state) addressObj.state = item.state;
  if (item.city) addressObj.city = item.city;
  if (item.postalCode) addressObj.postalCode = item.postalCode;
  if (item.countryCode) addressObj.countryCode = item.countryCode;
  return addressObj;
}
