import axios from 'axios';
import { getEnvConfig } from '../config/env';
import { SSORequestContext } from '../types/common/context.types';

type OrganizationRole = {
  roleId: string;
  definedRoleCode?: string;
  roleName?: string;
  roleType?: string;
  isDefault?: boolean;
};

type OrganizationRolesResponse = {
  data?: {
    items?: OrganizationRole[];
  };
};

export type OrganizationRoleIds = {
  doctorRoleId: string;
  patientRoleId: string;
};

const roleCache = new Map<string, OrganizationRoleIds>();

function isCodeMatch(role: OrganizationRole, allowedCodes: string[]): boolean {
  const code = (role.definedRoleCode || role.roleName || '').toUpperCase();
  return allowedCodes.includes(code);
}

function pickDoctorRole(items: OrganizationRole[]): OrganizationRole | undefined {
  return (
    items.find((role) => isCodeMatch(role, ['DOCTOR'])) ??
    items.find((role) => role.roleType?.toUpperCase() === 'STAFF' && role.isDefault === true)
  );
}

function pickPatientRole(items: OrganizationRole[]): OrganizationRole | undefined {
  return (
    items.find((role) => isCodeMatch(role, ['PATIENT', 'USER'])) ??
    items.find((role) => role.roleType?.toUpperCase() === 'USER' && role.isDefault === true)
  );
}

export async function getOrganizationRoleIds(
  organizationId: string,
  context?: SSORequestContext,
): Promise<OrganizationRoleIds> {
  const cached = roleCache.get(organizationId);
  if (cached) return cached;

  const env = getEnvConfig();
  const token = context?.serviceToken || env.INTERNAL_SERVICE_TOKEN;

  const response = await axios.get<OrganizationRolesResponse>(
    `${env.ROLE_SERVICE_BASE_URL}/org/${organizationId}/roles`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: env.TRU_TECH_TIMEOUT_MS,
    },
  );

  const items = response.data?.data?.items ?? [];
  const doctorRole = pickDoctorRole(items);
  const patientRole = pickPatientRole(items);

  if (!doctorRole?.roleId || !patientRole?.roleId) {
    throw new Error(`Doctor/Patient roles not found for organization ${organizationId}`);
  }

  const resolved = {
    doctorRoleId: doctorRole.roleId,
    patientRoleId: patientRole.roleId,
  };
  roleCache.set(organizationId, resolved);
  return resolved;
}

