import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { SecretManagerService } from '@api-hub/service-clients';
import { OrganizationService } from '../services/organization.service';
import { UserRepository } from '../repositories/user.repository';
import { getMobileScreens } from '../utils/lambda.utils';
import { fetchOrganizationDevices, buildSupportedVitalsArray } from '../utils/supportedVitals';
import { validateOrganizationIdParam } from '../validation/request.validators';

const organizationService = new OrganizationService();
const userRepository = new UserRepository();
const secretManagerService = new SecretManagerService();

const buildAdminAddress = (user?: Record<string, unknown>) => {
  if (!user) return undefined;
  const address = {
    country: user.country,
    address: user.address,
    state: user.state,
    city: user.city,
    countryCode: user.countryCode,
    postalCode: user.postalCode,
  } as Record<string, unknown>;
  const hasAny = Object.values(address).some((v) => v !== undefined && v !== null && String(v).trim() !== '');
  return hasAny ? address : undefined;
};

const ensureHttps = (url?: string | null): string | undefined => {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return trimmed.replace('http://', 'https://');
  return `https://${trimmed}`;
};

interface Params {
  organizationId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { organizationId } = req.params;
  const view = String(req.event.queryStringParameters?.view ?? '').toLowerCase();
  const isMinimalView = view === 'minimal';
  const isConfigView = view === 'config';
  console.log('req from handler', req);
  const authHeader = req.context.authHeader ?? req.event.headers?.Authorization ?? req.event.headers?.authorization ?? req.event.headers?.AUTHORIZATION;
  const { correlationId } = req.context;
  const event = req.event;

  if (isConfigView) {
    return organizationService.getOrganizationConfig(organizationId);
  }

  const organization = await organizationService.getOrganization(organizationId);
  const orgRecord = organization as unknown as Record<string, unknown>;
  const isRootOrg = organizationId.toUpperCase() === 'ROOT';

  if (isMinimalView) {
    const minimalOrgInfo: Record<string, unknown> =
      organization.organizationInfo && typeof organization.organizationInfo === 'object'
        ? { ...(organization.organizationInfo as Record<string, unknown>) }
        : {
            organizationID: organization.organizationId,
            organizationName: organization.name,
            name: organization.name,
            organizationType: organization.organizationType,
          };

    if (
      (!minimalOrgInfo.address || typeof minimalOrgInfo.address !== 'object')
    ) {
      const addressObj: Record<string, unknown> = {};
      if (organization.country) addressObj.country = organization.country;
      if (organization.address) addressObj.address = organization.address;
      if (organization.state) addressObj.state = organization.state;
      if (organization.city) addressObj.city = organization.city;
      if (organization.postalCode) addressObj.postalCode = organization.postalCode;
      if (organization.countryCode) addressObj.countryCode = organization.countryCode;
      if (Object.keys(addressObj).length > 0) {
        minimalOrgInfo.address = addressObj;
      }
    }

    return {
      organizationId: organization.organizationId,
      organizationID: organization.organizationId,
      name: organization.name,
      status: organization.status,
      organizationType: organization.organizationType,
      ...(organization.organizationConfig ? { organizationConfig: organization.organizationConfig } : {}),
      ...(organization.organizationConfigVersion !== undefined
        ? { organizationConfigVersion: organization.organizationConfigVersion }
        : {}),
      organizationInfo: minimalOrgInfo,
    };
  }

  const transformed: Record<string, unknown> = {};

  if (!isRootOrg) {
    transformed.accountAlias = organization.organizationId;
    console.log('authHeader', authHeader);
    const adminDetails = Array.isArray(organization.adminDetails) ? organization.adminDetails : [];
    let enrichedAdminDetails: unknown = null;
    if (adminDetails.length > 0) {
      const enrichedAdmins = await Promise.all(
        adminDetails.map(async (adminDetail: any) => {
          const adminId = adminDetail?.adminId;
          if (!adminId) return adminDetail;
          const user = await userRepository.getUser(organizationId, adminId, authHeader).catch(() => null);
          if (!user) return adminDetail;
          const mergedAddress = adminDetail?.adminAddress ?? buildAdminAddress(user);
          const adminRoleValue = adminDetail?.adminRole ?? user?.adminRole ?? (user as any)?.role;
          const roleNameValue = adminDetail?.roleName ?? (user as any)?.roleName ?? (user as any)?.role;
          const postalCodeValue = adminDetail?.postalCode ?? (user as any)?.postalCode ?? (user as any)?.zip;
          return {
            ...(mergedAddress && { adminAddress: mergedAddress }),
            adminId: adminDetail?.adminId ?? adminId,
            adminName: adminDetail?.adminName ?? (user as any)?.fullName ?? (user as any)?.name,
            ...(adminRoleValue && { adminRole: adminRoleValue }),
            emailAddress: adminDetail?.emailAddress ?? (user as any)?.emailAddress,
            namePrefix: adminDetail?.namePrefix ?? (user as any)?.namePrefix,
            phoneCode: adminDetail?.phoneCode ?? (user as any)?.phoneCode,
            phoneNumber: adminDetail?.phoneNumber ?? (user as any)?.phoneNumber,
            ...(postalCodeValue && { postalCode: postalCodeValue }),
            profilePic: adminDetail?.profilePic ?? (user as any)?.profilePic ?? '',
            ...(roleNameValue && { roleName: roleNameValue }),
          };
        }),
      );
      enrichedAdminDetails = Array.isArray(enrichedAdmins) && enrichedAdmins.length > 0 ? enrichedAdmins[0] : enrichedAdmins;
    } else if (organization.adminDetails && !Array.isArray(organization.adminDetails)) {
      enrichedAdminDetails = organization.adminDetails;
    }
    if (enrichedAdminDetails) transformed.adminDetails = enrichedAdminDetails;
    if (organization.createdAt || organization.createdDate) transformed.createdAt = organization.createdAt || organization.createdDate;
    if (organization.createdBy) transformed.createdBy = organization.createdBy;
    if (orgRecord.formAlert !== undefined) transformed.formAlert = orgRecord.formAlert;
    if (organization.modifiedBy) transformed.modifiedBy = organization.modifiedBy;
    if (organization.modifiedDate) transformed.modifiedDate = organization.modifiedDate;
  } else {
    if (organization.createdAt || organization.createdDate) transformed.createdDate = organization.createdAt || organization.createdDate;
    if (organization.email) transformed.emailAddress = organization.email;
    transformed.status = organization.status;
    if (organization.modifiedDate) transformed.modifiedDate = organization.modifiedDate;
  }

  if (organization.organizationInfo && typeof organization.organizationInfo === 'object') {
    transformed.organizationInfo = { ...(organization.organizationInfo as Record<string, unknown>) };
    const orgInfo = transformed.organizationInfo as Record<string, unknown>;
    if (!orgInfo.organizationID && organization.organizationId) orgInfo.organizationID = organization.organizationId;
    if (!orgInfo.organizationType && organization.organizationType) orgInfo.organizationType = organization.organizationType;
    if (!orgInfo.address || typeof orgInfo.address !== 'object') {
      const addressObj: Record<string, unknown> = {};
      if (organization.country) addressObj.country = organization.country;
      if (organization.address) addressObj.address = organization.address;
      if (organization.state) addressObj.state = organization.state;
      if (organization.city) addressObj.city = organization.city;
      if (organization.postalCode) addressObj.postalCode = organization.postalCode;
      if (organization.countryCode) addressObj.countryCode = organization.countryCode;
      if (Object.keys(addressObj).length > 0) orgInfo.address = addressObj;
    }
    if (!orgInfo.phoneNumber && organization.phoneNumber) orgInfo.phoneNumber = organization.phoneNumber;
    if (!orgInfo.organizationName && organization.name) orgInfo.organizationName = organization.name;
    if (!orgInfo.organizationSize && organization.organizationSize) orgInfo.organizationSize = organization.organizationSize;
    if (!orgInfo.phoneCode && organization.phoneCode) orgInfo.phoneCode = organization.phoneCode;
    if (!orgInfo.name && organization.name) orgInfo.name = organization.name;
  } else {
    const orgInfo: Record<string, unknown> = { organizationID: organization.organizationId };
    if (organization.organizationType) orgInfo.organizationType = organization.organizationType;
    const addressObj: Record<string, unknown> = {};
    if (organization.country) addressObj.country = organization.country;
    if (organization.address) addressObj.address = organization.address;
    if (organization.state) addressObj.state = organization.state;
    if (organization.city) addressObj.city = organization.city;
    if (organization.postalCode) addressObj.postalCode = organization.postalCode;
    if (organization.countryCode) addressObj.countryCode = organization.countryCode;
    if (Object.keys(addressObj).length > 0) orgInfo.address = addressObj;
    if (organization.phoneNumber) orgInfo.phoneNumber = organization.phoneNumber;
    if (organization.name) {
      orgInfo.organizationName = organization.name;
      orgInfo.name = organization.name;
    }
    if (organization.organizationSize) orgInfo.organizationSize = organization.organizationSize;
    if (organization.phoneCode) orgInfo.phoneCode = organization.phoneCode;
    transformed.organizationInfo = orgInfo;
  }

  if (organization.integration && typeof organization.integration === 'object') {
    const orgInfo = transformed.organizationInfo as Record<string, unknown> | undefined;
    if (orgInfo && typeof orgInfo === 'object') {
      const integration = { ...(organization.integration as Record<string, unknown>) };
      const apiKeyRef = typeof integration.apiKeyRef === 'string' ? integration.apiKeyRef.trim() : '';
      if (apiKeyRef) {
        const apiKey = await secretManagerService.fetchApiKey(apiKeyRef).catch(() => null);
        if (apiKey) {
          integration.apiKey = apiKey;
        }
      }
      orgInfo.integration = integration;
    }
  }

  if (!isRootOrg && organization.searchFields && typeof organization.searchFields === 'object') {
    transformed.searchFields = organization.searchFields;
  }
  if (organization.organizationConfig) transformed.organizationConfig = organization.organizationConfig;
  if (organization.organizationConfigVersion !== undefined) {
    transformed.organizationConfigVersion = organization.organizationConfigVersion;
  }
  if (!isRootOrg) transformed.status = organization.status;
  if (!isRootOrg && organization.traceId) transformed.traceId = organization.traceId;
  if (orgRecord.supportedRelations !== undefined && orgRecord.supportedRelations !== null) {
    transformed.supportedRelations = orgRecord.supportedRelations;
  } else {
    transformed.supportedRelations = [
      { name: 'Father', id: 'father' }, { name: 'Mother', id: 'mother' }, { name: 'Husband', id: 'husband' }, { name: 'Wife', id: 'wife' },
      { name: 'Son', id: 'son' }, { name: 'Daughter', id: 'daughter' }, { name: 'Brother', id: 'brother' }, { name: 'Sister', id: 'sister' },
      { name: 'Father-in-law', id: 'father-in-law' }, { name: 'Mother-in-law', id: 'mother-in-law' }, { name: 'Brother-in-law', id: 'brother-in-law' }, { name: 'Sister-in-law', id: 'sister-in-law' },
      { name: 'Uncle', id: 'uncle' }, { name: 'Aunt', id: 'aunt' }, { name: 'Cousin', id: 'cousin' }, { name: 'Friend', id: 'friend' },
    ];
  }

  if (!isRootOrg) {
    const linkedOrgs = await organizationService.getLinkedOrganizations(organizationId, {}, correlationId).catch(() => ({ items: [] }));
    transformed.linkedOrganizations = linkedOrgs.items || [];
  } else {
    transformed.linkedOrganizations = [];
  }

  if (!isRootOrg) {
    const deviceItems = await fetchOrganizationDevices(organizationId, authHeader, 'organization').catch(() => []);
    const uniqueVitals = Array.from(new Set(deviceItems?.flatMap((d: any) => d.supportedVitals ?? []) ?? []));
    transformed.supportedVitals = buildSupportedVitalsArray(uniqueVitals);
  } else {
    transformed.supportedVitals = [];
  }

  let mobileScreensValue = orgRecord.mobileScreens;
  if (mobileScreensValue === undefined || mobileScreensValue === null) {
    const orgInfoRecord = organization.organizationInfo as Record<string, unknown> | undefined;
    if (orgInfoRecord?.mobileScreens !== undefined && orgInfoRecord.mobileScreens !== null) mobileScreensValue = orgInfoRecord.mobileScreens;
  }
  if ((mobileScreensValue === undefined || mobileScreensValue === null || Object.keys((mobileScreensValue as Record<string, unknown>) || {}).length === 0)) {
    const functionName = process.env.GET_ONBOARDING_SCREENS_LAMBDA || 'dev_global_get_onboarding_screens';
    if (functionName) {
      const locale = event.headers?.['Accept-Language']?.split(',')[0]?.split('-')[0]?.toLowerCase() || 'en';
      const authorizer = (event.requestContext as any)?.authorizer;
      const userId = authorizer?.userID || authorizer?.userId;
      const lambdaParams = { body: { organizationId, ...(userId && { userId }) }, locale };
      const lambdaResult = await getMobileScreens(functionName, lambdaParams);
      if (lambdaResult) mobileScreensValue = lambdaResult;
    }
  }

  const orgDetails = transformed as Record<string, unknown>;
  const orgInfo = orgDetails?.organizationInfo as Record<string, unknown> | undefined;
  const addOrgInfoToObject = (obj: Record<string, unknown>) => {
    obj.orgName = orgInfo?.organizationName;
    const hospitalImage = orgInfo?.hospitalImage;
    obj.orgImage = ensureHttps(typeof hospitalImage === 'string' ? hospitalImage : hospitalImage === null ? null : undefined);
    const address = orgInfo?.address as Record<string, unknown> | undefined;
    if (address) {
      const addressParts = [address.address, address.city, address.state, address.country].filter(Boolean);
      obj.orgAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined;
    }
  };

  let mobileScreensForResponse: Record<string, unknown> = {};
  if (mobileScreensValue && typeof mobileScreensValue === 'object') {
    const mobileScreensObj = mobileScreensValue as Record<string, unknown>;
    const screens = mobileScreensObj.screens as Record<string, unknown> | undefined;
    if (screens && typeof screens === 'object') {
      Object.keys(screens).forEach((screenKey) => {
        const screenData = screens[screenKey];
        if (Array.isArray(screenData)) {
          screenData.forEach((item: unknown) => {
            if (item && typeof item === 'object') addOrgInfoToObject(item as Record<string, unknown>);
          });
        } else if (screenData && typeof screenData === 'object') {
          addOrgInfoToObject(screenData as Record<string, unknown>);
        }
      });
      mobileScreensForResponse = screens;
    } else {
      mobileScreensForResponse = mobileScreensObj;
    }
  }
  transformed.mobileScreens = mobileScreensForResponse;

  let mobileScreenValue = orgRecord.mobileScreen;
  if (mobileScreenValue === undefined || mobileScreenValue === null) {
    const orgInfoRecord = organization.organizationInfo as Record<string, unknown> | undefined;
    if (orgInfoRecord?.mobileScreen !== undefined && orgInfoRecord.mobileScreen !== null) mobileScreenValue = orgInfoRecord.mobileScreen;
  }
  if (mobileScreenValue && typeof mobileScreenValue === 'object') {
    const mobileScreenObj = mobileScreenValue as Record<string, unknown>;
    if (Array.isArray(mobileScreenObj.items)) {
      mobileScreenObj.items = mobileScreenObj.items.map((item: unknown) => {
        if (item && typeof item === 'object') {
          const itemObj = item as Record<string, unknown>;
          if (!itemObj.attributes || typeof itemObj.attributes !== 'object') itemObj.attributes = {};
          const attributes = itemObj.attributes as Record<string, unknown>;
          attributes.orgName = orgInfo?.organizationName;
          attributes.orgImage = ensureHttps(typeof orgInfo?.hospitalImage === 'string' ? orgInfo.hospitalImage : undefined);
          const address = orgInfo?.address as Record<string, unknown> | undefined;
          if (address) {
            const addressParts = [address.address, address.city, address.state, address.country].filter(Boolean);
            attributes.orgAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined;
          }
        }
        return item;
      });
    }
  }
  transformed.mobileScreen = mobileScreenValue !== undefined && mobileScreenValue !== null ? mobileScreenValue : {};
  transformed.features = orgRecord.features !== undefined && orgRecord.features !== null ? orgRecord.features : [];

  return transformed;
};

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationIdParam,
});
