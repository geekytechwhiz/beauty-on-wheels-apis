import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/logger';
import { UserService } from '../services/user.service';
import { assignUserRole } from '../services/role.service';
import { UserRepository } from '../repositories/user.repository';
import { getOrganization } from '../services/organization.service';
import { publishUserCreatedEvent } from '../events/UserCreated';
import { validateCreateUser } from '../validation/request.validators';
import { ExternalIdentity } from '../models';

const userService = new UserService();
const userRepository = new UserRepository();
const baseLogger = createLogger({ service: 'user-service', redactPII: true });

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
      externalIdentity: ExternalIdentity;
    };
  },
) => {
  const data = req.validatedCreateUser!;
  const { userInfo, userRole, userType, organizationID, userID, externalIdentity } = data;
  const authHeader = req.context.authHeader;
  const correlationId = req.context.correlationId;
  const body = req.body ?? {};
  const handlerStart = Date.now();
  const log = createChildLogger(baseLogger, { correlationId, organizationID, invitedBy: userID });

  // if (organizationID) {
  //   const orgValidationStart = Date.now();
  //   const org = await getOrganization(organizationID, authHeader, {
  //     minimal: true,
  //   });
  //   if (!org) {
  //     throwOrgError('Organization does not exist', 'ORGANIZATION_NOT_FOUND');
  //   }
  //   const status = org?.status ? String(org?.status).toLowerCase() : '';
  //   if (['on_hold', 'disabled', 'not_exist'].includes(status)) {
  //     throwOrgError('Organization is not available', 'ORGANIZATION_NOT_AVAILABLE');
  //   }
  //   log.info({
  //     event: 'createUser_org_validation_timing',
  //     durationMs: Date.now() - orgValidationStart,
  //   });
  // }

  const roleIds = Array.isArray(userRole)
    ? userRole.map((roleId: string) => String(roleId))
    : userRole
      ? [String(userRole)]
      : [];
  const contactAddress = (userInfo.contact as any)?.address;
  const userTypeUpper = String(userType || '').toUpperCase();
  const userData: any = {
    externalIdentity: externalIdentity,
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
    const roleLookupStart = Date.now();
    const rolePermissions = await userRepository
      .getRolePermissions(roleIds[0], organizationID)
      .catch(() => []);
    if (rolePermissions && rolePermissions.length > 0) {
      const exactRoleMatch =
        rolePermissions.find((item: any) => item.SK === `ROLE#${roleIds[0]}`) ||
        rolePermissions[0];
      definedRoleCode = exactRoleMatch?.definedRoleCode;
      userData.roleName = exactRoleMatch?.roleName || definedRoleCode || '';
    }
    log.info({
      event: 'createUser_role_lookup_timing',
      durationMs: Date.now() - roleLookupStart,
    });
  }

  if (definedRoleCode !== undefined && definedRoleCode !== null) {
    userData.definedRoleCode = String(definedRoleCode);
  }

  const serviceCallStart = Date.now();
  userData.__skipOrganizationValidation = true;
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
  log.info({
    event: 'createUser_core_create_timing',
    userId: result.userID,
    durationMs: Date.now() - serviceCallStart,
  });

  const userCreatedEventStart = Date.now();
  try {
    await publishUserCreatedEvent({
      eventName: 'UserCreated.v1',
      correlationId: correlationId ?? '',
      userId: result.userID,
      email: userInfo?.contact?.email ?? '',
      name: userInfo?.name ?? userData.fullName ?? '',
    });
    log.info({
      event: 'createUser_user_created_event_published',
      userId: result.userID,
      durationMs: Date.now() - userCreatedEventStart,
    });
  } catch (err: any) {
    log.warn({
      event: 'createUser_user_created_event_failed',
      userId: result.userID,
      durationMs: Date.now() - userCreatedEventStart,
      error: err?.message || String(err),
    });
  }

  if (roleIds.length > 0) {
    const roleAssignmentStart = Date.now();
    const syncRoleAssignmentEnabled =
      String((globalThis as any)?.process?.env?.CREATE_USER_SYNC_ROLE_ASSIGNMENT || '').toLowerCase() === 'true';
    const assignRolePromise = assignUserRole(
      roleIds[0],
      organizationID,
      result.userID,
      userInfo.name,
      userInfo.contact.email ?? '',
      userInfo.contact.phone ?? '',
      userInfo.profilePic,
      authHeader,
    )
      .then(() => {
        log.info({
          event: 'createUser_assignUserRole_success',
          userId: result.userID,
          mode: syncRoleAssignmentEnabled ? 'sync' : 'async',
          durationMs: Date.now() - roleAssignmentStart,
        });
      })
      .catch(() => {
        log.warn({
          event: 'createUser_assignUserRole_failed',
          userId: result.userID,
          mode: syncRoleAssignmentEnabled ? 'sync' : 'async',
          durationMs: Date.now() - roleAssignmentStart,
        });
      });

    if (syncRoleAssignmentEnabled) {
      await assignRolePromise;
    } else {
      void assignRolePromise;
    }
  }

  log.info({
    event: 'createUser_handler_total_timing',
    userId: result.userID,
    durationMs: Date.now() - handlerStart,
  });

  return { invitedUser: result.userID };
};

export const main = withLambdaHandler(handler, {
  validator: validateCreateUser,
});
