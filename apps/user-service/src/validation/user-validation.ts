import { NotFoundError, OrganizationNotFoundError } from '../errors/user-errors.js';
import {
  FnFResponse,
  FnFUser,
  PatientResponse,
  PatientUser,
  StaffResponse,
  StaffUser
} from '../models/user/UserDTO';
import { getOrganization } from '../services/organization.service';
export class UserValidationService { 
  constructor() { 
  }
   

  static async validateOrganization(
    organizationID: string,
    authHeader?: string,
  ) {
    if (!organizationID) return;

    const org = await getOrganization(organizationID, authHeader);

    if (!org) {
      throw new OrganizationNotFoundError(
        organizationID,
      );
    }

    const status = org?.status ? String(org.status).toLowerCase() : '';

    if (['on_hold', 'disabled', 'not_exist'].includes(status)) {
      throw new NotFoundError(
        organizationID,
        'ORGANIZATION_NOT_FOUND',
      );
    }
    return org;
  }

  static normalizeRoleIds(userRole: any): string[] {
    return Array.isArray(userRole)
      ? userRole.map((r: string) => String(r))
      : userRole
        ? [String(userRole)]
        : [];
  }
   
  async transformPatientResponse(
    patient: PatientUser,
    orgData: any,
  ): Promise<PatientResponse> {
    // Get role information
    const roleInfo = await this.getRoleInfo(
      patient.userID,
      patient.organizationID,
    );

    // Calculate account age
    const accountAge = this.calculateAccountAge(patient.createdDate);

    const response: PatientResponse = {
      ...patient,
      accountAge,
      organizationName: orgData?.name || '',
      organizationAddress: orgData?.address || {},
      organizationEmailAddress: orgData?.emailAddress || '',
      ...roleInfo,
      scheduleConfiguration: {},
      currencies: [],
      dateFormat: 'MM/DD/YYYY',
      tabBar: [],
    };

    return response;
  }
  async transformStaffResponse(
    staff: StaffUser,
    orgData: any,
  ): Promise<StaffResponse> {
    // Get role information
    const roleInfo = await this.getRoleInfo(staff.userID, staff.organizationID);

    const response: StaffResponse = {
      ...staff,
      organizationName: orgData?.name || '',
      organizationAddress: orgData?.address || {},
      ...roleInfo,
      currencies: [],
      dateFormat: 'MM/DD/YYYY',
    };

    return response;
  }

  async transformFnFResponse(fnf: FnFUser, orgData: any): Promise<FnFResponse> {
    // Get role information (limited for FnF)
    const roleInfo = await this.getRoleInfo(fnf.userID, fnf.organizationID);

    const response: FnFResponse = {
      ...fnf,
      organizationName: orgData?.name || '',
      roleName: roleInfo.roleName,
      userPermissions: roleInfo.userPermissions,
      definedRoleCode: roleInfo.definedRoleCode,
    };

    return response;
  }

  private async getRoleInfo(
    userID: string,
    organizationID: string,
  ): Promise<{
    roleName: string;
    roleType: string;
    roleId: string;
    userRoles: string[];
    userPermissions: any[];
    permission: any;
    isDefault: boolean;
    definedRoleCode?: string;
  }> {
    // TODO: Implement role lookup from role repository
    return {
      roleName: '',
      roleType: '',
      roleId: '',
      userRoles: [],
      userPermissions: [],
      permission: {},
      isDefault: false,
      definedRoleCode: undefined,
    };
  }

  private calculateAccountAge(createdDate: number): {
    years: number;
    months: number;
    days: number;
  } {
    const now = Date.now();
    const diff = now - createdDate;
    const years = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    const months = Math.floor(
      (diff % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000),
    );
    const days = Math.floor(
      (diff % (30.44 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000),
    );

    return { years, months, days };
  }
}
 
