import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { assignUserRole } from '../services/role.service';
import { UserRepository } from '../repositories/user.repository';
import { getOrganization } from '../services/organization.service';
import { PackageRepository } from '../repositories/package.repositrory';
import { RoleRepository } from '../repositories/role.repository';
import { validateCreateUser } from '../validation/request.validators';

const userService = new UserService();
const userRepository = new UserRepository();
const packagRepository = new PackageRepository();
const roleRepository = new RoleRepository();

function throwOrgError(message: string, code: string) {
  const err: any = new Error(message);
  err.statusCode = 400;
  err.code = code;
  throw err;
}

const handler = async (
  req: LambdaRequest<any> & {
    validatedCreateUser?: {
      userInfo: any;
      userRole: any;
      userType: any;
      organizationID: string;
      userID: string;
    };
  },
) => {
  const data = req.validatedCreateUser!;
  const { userInfo, userRole, userType, organizationID, userID } = data;
  const authHeader = req.context.authHeader;
  const correlationId = req.context.correlationId;
  const body = req.body ?? {};

  if (organizationID) {
    const org = await getOrganization(organizationID, authHeader);
    if (!org) {
      throwOrgError('Organization does not exist', 'ORGANIZATION_NOT_FOUND');
    }
    const status = org.status ? String(org.status).toLowerCase() : '';
    if (['on_hold', 'disabled', 'not_exist'].includes(status)) {
      throwOrgError('Organization is not available', 'ORGANIZATION_NOT_AVAILABLE');
    }
  }

  const roleIds = Array.isArray(userRole)
    ? userRole.map((roleId: string) => String(roleId))
    : userRole
      ? [String(userRole)]
      : [];
  const contactAddress = (userInfo.contact as any)?.address;
  const userTypeUpper = String(userType || '').toUpperCase();
  const userData: any = {
    fullName: userInfo.name,
    namePrefix: userInfo.namePrefix,
    profilePic: userInfo.profilePic,
    code: userInfo.code,
    licenseNumber: userInfo.licenseNumber,
    emailAddress: userInfo.contact.email,
    phoneNumber: userInfo.contact.phone,
    phoneCode: userInfo.contact.phoneCode,
    dateOfBirth: userInfo.dateOfBirth,
    department: userInfo.department,
    gender: userInfo.gender,
    specialty: userInfo.specialty,
    slotDurationInMinutes: userInfo.slotDurationInMinutes,
    experienceInYears: userInfo.experienceInYears,
    bio: userInfo.bio,
    userRole: userRole,
    userType: userType,
    ...(userTypeUpper === 'STAFF'
      ? { workingHours: userInfo.workingHours || {} }
      : userInfo.workingHours
        ? { workingHours: userInfo.workingHours }
        : {}),
    address: contactAddress?.address || userInfo.address || '',
    city: contactAddress?.city || userInfo.city || '',
    state: contactAddress?.state || userInfo.state || '',
    country: contactAddress?.country || userInfo.country || '',
    postalCode: contactAddress?.postalCode || userInfo.postalCode || '',
    street: contactAddress?.street || '',
    zip: contactAddress?.zip || '',
    countryCode: contactAddress?.countryCode || '',
    stateCode: contactAddress?.stateCode || '',
    emergencyContact: (userInfo as any).emergencyContact || {},
    medicalHistory: (userInfo as any).medicalHistory || {},
    insuranceDetails: (userInfo as any).insuranceDetails || {},
    workSchedule: (userInfo as any).workSchedule || {},
    inviteDetails: (userInfo as any).inviteDetails || {},
    position: (userInfo as any).position || '',
    userTimeZone: (userInfo as any).userTimeZone || '',
    devices: (userInfo as any).devices || [],
    assignRoomNo: (userInfo as any).assignRoomNo || undefined,
    username: (userInfo as any).username || undefined,
  };

  const isEmail = userInfo.contact.email && userInfo.contact.email.includes('@');
  userData.srcRegisEntity = isEmail ? 'email' : 'phone_number';
  let definedRoleCode: string | undefined;

  if (roleIds.length > 0) {
    const rolePermissions = await userRepository
      .getRolePermissions(roleIds[0], organizationID)
      .catch(() => []);
    if (rolePermissions && rolePermissions.length > 0) {
      const exactRoleMatch =
        rolePermissions.find((item: any) => item.SK === `ROLE#${roleIds[0]}`) ||
        rolePermissions[0];
      definedRoleCode = exactRoleMatch?.definedRoleCode;
      userData.roleName = exactRoleMatch?.roleName || definedRoleCode || '';

      const hasExistingFeatures =
        Array.isArray((exactRoleMatch as any)?.features) &&
        (exactRoleMatch as any).features.length > 0;

      if (definedRoleCode === 'ADMIN' && !hasExistingFeatures) {
        const orgFeatures = await packagRepository
          .getOrgFeatures(organizationID, authHeader)
          .catch(() => []);
        if (orgFeatures && orgFeatures.length > 0) {
          const { roleId, roleName, roleDescription, roleType } = exactRoleMatch as any;
          await roleRepository
            .saveRoles(
              organizationID,
              roleId,
              roleName,
              roleDescription,
              roleType,
              orgFeatures,
              authHeader,
            )
            .catch(() => {});
        }
      }
    }
  }

  if (definedRoleCode !== undefined && definedRoleCode !== null) {
    userData.definedRoleCode = String(definedRoleCode);
  }

  if (roleIds.length > 0) {
    const rolePermissions = await userRepository
      .getRolePermissions(roleIds[0], organizationID)
      .catch(() => []);
    if (rolePermissions && rolePermissions.length > 0) {
      const exactRoleMatch =
        rolePermissions.find((item: any) => item.SK === `ROLE#${roleIds[0]}`) ||
        rolePermissions[0];
      userData.roleName = exactRoleMatch?.roleName || '';
    }
  }

  const result = await userService.createUser(
    userData,
    userData.roleName,
    organizationID,
    userID,
    correlationId,
    authHeader,
    body?.userInfo?.friendNFamily,
    body?.userInfo?.assignDoctor,
  );

  if (roleIds.length > 0) {
    await assignUserRole(
      roleIds[0],
      organizationID,
      result.userID,
      userInfo.name,
      userInfo.contact.email ?? '',
      userInfo.contact.phone ?? '',
      userInfo.profilePic,
      authHeader,
    ).catch(() => {});
  }

  return { invitedUser: result.userID };
};

export const main = withLambdaHandler(handler, {
  validator: validateCreateUser,
});
