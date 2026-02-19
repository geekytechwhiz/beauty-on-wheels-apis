import { randomUUID } from 'crypto';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type {
  BaseUserResponse,
  StaffResponse,
  PatientResponse,
  LabPatientResponse,
  AssignedPatientResponse,
} from '../models';

export const getCorrelationId = (headers: Record<string, string | undefined>): string =>
  headers['x-correlation-id'] || headers['X-Correlation-ID'] || randomUUID();

export const generateFileId = (): string => randomUUID();

/**
 * Extract user ID from API Gateway authorizer context.
 * Supports authorizer.userID, authorizer.userId, and authorizer['custom:userID'] (no claims object required).
 */
export function getAuthorizerUserId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  console.log('authorizer', authorizer);
  return (authorizer?.userID ?? authorizer?.userId ?? authorizer?.claims?.['custom:userID']) as string | undefined;
}

/**
 * Extract organization ID from API Gateway authorizer context.
 * Supports authorizer.organizationID, authorizer.organizationId, and authorizer['custom:organizationID'] (no claims object required).
 */
export function getAuthorizerOrganizationId(event: APIGatewayProxyEvent): string | undefined {
  const authorizer = (event.requestContext as any)?.authorizer;
  console.log('authorizer', authorizer);
  return (authorizer?.organizationID ?? authorizer?.organizationId ?? authorizer?.claims?.['custom:organizationID']) as string | undefined;
}

/**
 * Decode Cognito JWT from Authorization header and extract userId, organizationId (and sub for Cognito lookup).
 * Used when authorizer context does not provide these (e.g. searchFnF with pool-specific tokens).
 */
export function getUserIdAndOrganizationIdFromToken(authHeader: string | undefined): {
  userId?: string;
  organizationId?: string;
  sub?: string;
} {
  if (!authHeader || typeof authHeader !== 'string') return {};
  try {
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const base64Url = token.split('.')[1];
    if (!base64Url) return {};
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload) as Record<string, unknown>;
    return {
      userId:
        (decoded['custom:userID'] as string) ??
        (decoded['custom:userId'] as string) ??
        (decoded.userID as string) ??
        (decoded.userId as string),
      organizationId:
        (decoded['custom:organizationID'] as string) ??
        (decoded['custom:organizationId'] as string) ??
        (decoded.organizationID as string) ??
        (decoded.organizationId as string),
      sub: decoded.sub as string,
    };
  } catch {
    return {};
  }
}

/** Parse phone into phoneCode and number (e.g. +919876543210 -> +91, 9876543210). */
export function parsePhoneForCreateUser(phone: string): { phoneCode: string; phoneNumber: string } {
  const raw = (phone ?? '').toString().replace(/\s/g, '').trim();
  if (!raw) return { phoneCode: '', phoneNumber: '' };
  const match = raw.match(/^(\+\d{1,4})(.*)$/);
  if (match) {
    return { phoneCode: match[1], phoneNumber: (match[2] ?? '').trim() };
  }
  return { phoneCode: '', phoneNumber: raw };
}

/**
 * Build createUser payload from F&F search body for the "user not found → invite" flow.
 * Maps fullName, email, phone, roles to the shape expected by userService.createUser.
 */
export function buildCreateUserPayloadFromFnfSearch(
  body: {
    fullName: string;
    email?: string;
    phone?: string;
    roles?: string[];
  },
  _organizationID: string,
  _inviterUserID: string,
): Record<string, unknown> {
  const email = (body.email ?? '').toString().trim();
  const phoneRaw = (body.phone ?? '').toString().replace(/\s/g, '').trim();
  const { phoneCode, phoneNumber } = parsePhoneForCreateUser(phoneRaw);
  const roles = Array.isArray(body.roles) ? body.roles.map(String) : [];
  return {
    fullName: (body.fullName ?? '').trim(),
    emailAddress: email || '',
    phoneNumber: phoneNumber || '',
    phoneCode: phoneCode || '',
    userType: 'USER',
    userRole: roles,
  };
}

/**
 * Maps base user fields from repository data to BaseUserResponse
 * Common fields shared across all response types
 */
function mapBaseUserResponse(user: any): BaseUserResponse {
  const isActive = user.isActive !== undefined ? user.isActive : (user.status !== undefined ? user.status : true);
  const status = typeof user.status === 'boolean' ? user.status : isActive;
  
  return {
    userID: user.userID || user.userId || '',
    fullName: user.fullName || '',
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    emailAddress: user.emailAddress || '',
    phoneNumber: user.phoneNumber || '',
    phoneCode: user.phoneCode || '',
    organizationID: user.organizationID || user.organizationId || '',
    profilePic: user.profilePic || '',
    mrn: user.mrn || '',
    createdDate: user.createdDate || user.createdAt || 0,
    createdAt: user.createdAt || user.createdDate || 0,
    modifiedDate: user.modifiedDate || user.createdDate || 0,
    status,
    isActive,
    isRpmUser: user.isRpmUser || false,
    accountType: user.accountType || (user.isRpmUser ? 'RPM' : 'REGULAR'),
    city: user.city || '',
    postalCode: user.postalCode || user.zip || '',
    pk: user.pk || '',
    sk: user.sk || '',
    sk1: user.sk1 || user.userType || '',
    roleType: user.roleType || user.userType || '',
    roleID: user.roleID || user.roleId || '',
    roleName: user.roleName || '',
    definedRoleCode: user.definedRoleCode || user.userType || '',
    userType: user.userType || '',
  };
}

/**
 * Maps UserResponse array to PatientResponse array
 * Transforms repository user data to patient-specific response format
 */
export function mapPatientResponse(users: any[]): PatientResponse[] {
  return users.map((user) => {
    const base = mapBaseUserResponse(user);
    return {
      ...base,
      state: user.state || '',
      country: user.country || '',
      lastAppointment: user.lastAppointment ?? null,
      reporterId: user.reporterId || '',
      doctor: user.reporterName || '',
      patientId: user.userID || user.userId || '',
      patientOrgId: user.organizationID || user.organizationId || '',
      gender: user.gender || '',
      medicalHistory: user.medicalHistory ?? null,
      dateOfBirth: user.dateOfBirth ?? null,
    };
  });
}

/**
 * Maps UserResponse array to LabPatientResponse array
 * Transforms repository user data to lab patient-specific response format
 */
export function mapLabPatientResponse(users: any[]): LabPatientResponse[] {
  return users.map((user) => {
    const base = mapBaseUserResponse(user);
    return {
      ...base,
      state: user.state || '',
      country: user.country || '',
      lastAppointment: user.lastAppointment ?? null,
      reporterId: user.reporterId || '',
      doctor: user.reporterName || '',
      patientId: user.userID || user.userId || '',
      patientOrgId: user.organizationID || user.organizationId || '',
      gender: user.gender || '',
      medicalHistory: user.medicalHistory ?? null,
      dateOfBirth: user.dateOfBirth ?? null,
    };
  });
}

/**
 * Maps UserResponse array to AssignedPatientResponse array
 * Transforms repository user data to assigned patient-specific response format
 */
export function mapAssignedPatientResponse(users: any[]): AssignedPatientResponse[] {
  return users.map((user) => {
    const base = mapBaseUserResponse(user);
    return {
      ...base,
      state: user.state || '',
      country: user.country || '',
      lastAppointment: user.lastAppointment ?? null,
      reporterId: user.reporterId || '',
      doctor: user.reporterName || '',
      patientId: user.userID || user.userId || '',
      patientOrgId: user.organizationID || user.organizationId || '',
      gender: user.gender || '',
      medicalHistory: user.medicalHistory ?? null,
      dateOfBirth: user.dateOfBirth ?? null,
    };
  });
}

/**
 * Maps UserResponse array to StaffResponse array
 * Transforms repository user data to staff-specific response format
 */
export function mapStaffResponse(users: any[]): StaffResponse[] {
  return users.map((user) => {
    const base = mapBaseUserResponse(user);
    return {
      ...base,
      sk2: user.sk2 || user.specialty || undefined,
    };
  });
}

/**
 * Legacy function: Maps UserResponse array to patient response format
 * @deprecated Use mapPatientResponse instead
 */
export const mapUserResponse = mapPatientResponse;  