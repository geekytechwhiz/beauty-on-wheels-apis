import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationListPost } from '../validation/request.validators';

const organizationService = new OrganizationService();


interface ListBody {
  organizationId?: string;
  organizationID?: string;
  status?: unknown;
  organizationType?: unknown;
  assignedPackagesName?: unknown;
  adminName?: string;
  organizationName?: string;
  country?: string;
  state?: string;
  city?: string;
  limit?: number | string;
  nextPaginationKey?: string;
}

const handler = async (req: LambdaRequest<Params, ListBody>) => {
  const body = req.body ?? {};
  const event = req.event as unknown as Record<string, unknown>;
  let organizationId = body.organizationId ?? body.organizationID ?? (event?.organizationID as string | undefined);
  if (organizationId === 'ROOT') organizationId = undefined;

  const limitRaw = body.limit;
  const limit = typeof limitRaw === 'string' ? Number(limitRaw) : typeof limitRaw === 'number' ? limitRaw : undefined;
  const nextPaginationKey = body.nextPaginationKey;

  const result = await organizationService.listOrganizations({
    organizationId,
    status: toArray(body.status),
    organizationType: toArray(body.organizationType),
    adminName: body.adminName,
    organizationName: body.organizationName,
    country: body.country,
    state: body.state,
    city: body.city,
    assignedPackagesName: toArray(body.assignedPackagesName),
    limit: Number.isFinite(limit) ? limit : undefined,
    nextPaginationKey: typeof nextPaginationKey === 'string' ? nextPaginationKey : undefined,
  });

  const organizations = result.items.map((item: any) => {
    const transformed: Record<string, unknown> = {};
    if (item.organizationInfo && typeof item.organizationInfo === 'object') {
      transformed.organizationInfo = { ...(item.organizationInfo as Record<string, unknown>) };
      const orgInfo = transformed.organizationInfo as Record<string, unknown>;
      if (orgInfo.organizationName && !orgInfo.name) orgInfo.name = orgInfo.organizationName;
      if (!orgInfo.organizationID && item.organizationId) orgInfo.organizationID = item.organizationId;
      if (!orgInfo.address || typeof orgInfo.address !== 'object') {
        const addressObj: Record<string, unknown> = {};
        if (item.country) addressObj.country = item.country;
        if (item.address) addressObj.address = item.address;
        if (item.state) addressObj.state = item.state;
        if (item.city) addressObj.city = item.city;
        if (item.postalCode) addressObj.postalCode = item.postalCode;
        if (item.countryCode) addressObj.countryCode = item.countryCode;
        if (Object.keys(addressObj).length > 0) orgInfo.address = addressObj;
      } else {
        const existingAddress = orgInfo.address as Record<string, unknown>;
        if (item.country && !existingAddress.country) existingAddress.country = item.country;
        if (item.address && !existingAddress.address) existingAddress.address = item.address;
        if (item.state && !existingAddress.state) existingAddress.state = item.state;
        if (item.city && !existingAddress.city) existingAddress.city = item.city;
        if (item.postalCode && !existingAddress.postalCode) existingAddress.postalCode = item.postalCode;
        if (item.countryCode && !existingAddress.countryCode) existingAddress.countryCode = item.countryCode;
      }
      if (!orgInfo.organizationName && item.name) orgInfo.organizationName = item.name;
      if (!orgInfo.name && item.name) orgInfo.name = item.name;
      if (!orgInfo.organizationType && item.organizationType) orgInfo.organizationType = item.organizationType;
      if (!orgInfo.phoneCode && item.phoneCode) orgInfo.phoneCode = item.phoneCode;
      if (!orgInfo.phoneNumber && item.phoneNumber) orgInfo.phoneNumber = item.phoneNumber;
      if (!orgInfo.emailAddress && item.email) orgInfo.emailAddress = item.email;
      if (item.hospitalBio !== undefined && orgInfo.hospitalBio === undefined) orgInfo.hospitalBio = item.hospitalBio;
      if (item.hospitalImage && !orgInfo.hospitalImage) orgInfo.hospitalImage = item.hospitalImage;
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
      const addressObj: Record<string, unknown> = {};
      if (item.country) addressObj.country = item.country;
      if (item.address) addressObj.address = item.address;
      if (item.state) addressObj.state = item.state;
      if (item.city) addressObj.city = item.city;
      if (item.postalCode) addressObj.postalCode = item.postalCode;
      if (item.countryCode) addressObj.countryCode = item.countryCode;
      if (Object.keys(addressObj).length > 0) orgInfo.address = addressObj;
      transformed.organizationInfo = orgInfo;
    }
    transformed.status = item.status;
    if (item.adminDetails) {
      if (Array.isArray(item.adminDetails) && item.adminDetails.length > 0) transformed.adminDetails = item.adminDetails[0];
      else if (!Array.isArray(item.adminDetails)) transformed.adminDetails = item.adminDetails;
    }
    if (item.createdAt || item.createdDate) transformed.createdAt = item.createdAt || item.createdDate;
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.formAlert !== undefined) transformed.formAlert = itemRecord.formAlert;
    if (item.searchFields && typeof item.searchFields === 'object') transformed.searchFields = item.searchFields;
    return transformed;
  });

  return { items: organizations };
};

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationListPost,
});
