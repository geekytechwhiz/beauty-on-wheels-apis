export type NormalizedOrganizationPayload = {
  organizationId?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  website?: string;
  taxId?: string;
  registrationNumber?: string;
  description?: string;
  industry?: string;
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';
};

type NormalizationResult = {
  data: NormalizedOrganizationPayload;
  errors: Array<{ field: string; message: string }>;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const buildPhone = (phoneCode?: unknown, phoneNumber?: unknown): string | undefined => {
  const code = normalizeString(phoneCode);
  const number = normalizeString(phoneNumber);
  if (!code && !number) return undefined;
  if (code && number) {
    return code.startsWith('+') ? `${code}${number}` : `+${code}${number}`;
  }
  return number;
};

export const normalizeOrganizationPayload = (input: any): NormalizationResult => {
  const errors: Array<{ field: string; message: string }> = [];
  const organizationInfo = input?.organizationInfo || {};
  const adminDetails = input?.adminDetails || {};
  const orgAddress = organizationInfo?.organizationAdd || organizationInfo?.address || {};

  const organizationId =
    normalizeString(input?.accountAlias) ||
    normalizeString(input?.organizationId) ||
    normalizeString(input?.organizationID) ||
    normalizeString(organizationInfo?.orgId) ||
    normalizeString(organizationInfo?.organizationID);

  const name =
    normalizeString(input?.name) ||
    normalizeString(organizationInfo?.organizationName) ||
    normalizeString(organizationInfo?.name);

  const email =
    normalizeString(input?.email) ||
    normalizeString(organizationInfo?.emailAddress) ||
    normalizeString(adminDetails?.emailAddress);

  const phone =
    normalizeString(input?.phone) ||
    buildPhone(organizationInfo?.phoneCode, organizationInfo?.phoneNumber) ||
    buildPhone(adminDetails?.phoneCode, adminDetails?.phoneNumb);

  const address =
    normalizeString(input?.address) ||
    normalizeString(orgAddress?.address) ||
    normalizeString(orgAddress?.street);

  const city = normalizeString(input?.city) || normalizeString(orgAddress?.city);
  const state = normalizeString(input?.state) || normalizeString(orgAddress?.state);
  const country = normalizeString(input?.country) || normalizeString(orgAddress?.country);
  const postalCode = normalizeString(input?.postalCode) || normalizeString(orgAddress?.postalCode);

  const website = normalizeString(input?.website) || normalizeString(organizationInfo?.website);
  const description = normalizeString(input?.description) || normalizeString(organizationInfo?.hospitalBio);
  const industry = normalizeString(input?.industry) || normalizeString(organizationInfo?.organizationType);
  const taxId = normalizeString(input?.taxId) || normalizeString(organizationInfo?.taxId);
  const registrationNumber =
    normalizeString(input?.registrationNumber) || normalizeString(organizationInfo?.licenseNumber);

  const sizeCandidate =
    normalizeString(input?.size) ||
    normalizeString(organizationInfo?.organizationSize) ||
    normalizeString(organizationInfo?.orgSize);
  const size =
    sizeCandidate && ['SMALL', 'MEDIUM', 'LARGE'].includes(sizeCandidate.toUpperCase())
      ? (sizeCandidate.toUpperCase() as NormalizedOrganizationPayload['size'])
      : undefined;

  if (organizationInfo && Object.keys(organizationInfo).length > 0) {
    if (!name) {
      errors.push({ field: 'organizationInfo.organizationName', message: 'Organization name is required' });
    }
    if (!orgAddress || Object.keys(orgAddress).length === 0) {
      errors.push({ field: 'organizationInfo.organizationAdd', message: 'Organization address is required' });
    } else {
      if (!address) errors.push({ field: 'organizationInfo.organizationAdd.address', message: 'Address is required' });
      if (!city) errors.push({ field: 'organizationInfo.organizationAdd.city', message: 'City is required' });
      if (!state) errors.push({ field: 'organizationInfo.organizationAdd.state', message: 'State is required' });
      if (!country) errors.push({ field: 'organizationInfo.organizationAdd.country', message: 'Country is required' });
      if (!postalCode) errors.push({ field: 'organizationInfo.organizationAdd.postalCode', message: 'Postal code is required' });
    }
  }

  return {
    data: {
      organizationId,
      name,
      email,
      phone,
      address,
      city,
      state,
      country,
      postalCode,
      status: input?.status || organizationInfo?.status,
      website,
      taxId,
      registrationNumber,
      description,
      industry,
      size,
    },
    errors,
  };
};

export const generateOrganizationId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(16).slice(2, 10);
  return `${timestamp}${random}`;
};
