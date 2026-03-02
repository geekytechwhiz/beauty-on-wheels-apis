
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context, APIGatewayProxyHandler } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { assignUserRole } from '../services/role.service';
import { OrganizationRepository } from '../repositories/organization.repository';
import { UserRepository } from '../repositories/user.repository';
import {
  createLogger,
  extractCorrelationId,
  serializeError,
  logHttpRequest,
  extractAwsRequestId,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { createUserSchema } from '../validation/user.validation';
import { UserNotFoundError, UserAlreadyExistsError } from '../utils/errors';
import {
  getAuthorizerUserId,
  getAuthorizerOrganizationId,
} from '../utils/helpers';
import { getOrganization } from '../services/organization.service';
import { PackageRepository } from '../repositories/package.repositrory';
import { RoleRepository } from '../repositories/role.repository';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();
const organizationRepository = new OrganizationRepository();
const userRepository = new UserRepository();
const packagRepository = new PackageRepository();
const roleRepository = new RoleRepository();

export async function createUser(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'createUser_received', eventData: event });

  let body: any;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'createUser_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      event.path || '/users',
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'Invalid JSON body' }],
      },
    );
  }

  if (!body?.organizationID) {
    body.organizationID =
      (event as any).organizationID ?? getAuthorizerOrganizationId(event);
  }
  if (!body?.userID) {
    body.userID = (event as any).userID ?? getAuthorizerUserId(event);
  }
  logger.info({
    event: 'createUser_organization_check',
    organizationID: body.organizationID,
    userID: body.userID,
  });
  const validation = createUserSchema.safeParse(body);

  if (!validation.success) {
    logger.warn({
      event: 'createUser_validation_error',
      errors: validation.error.issues,
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      event.path || '/users',
      400,
      duration,
      correlationId,
    );
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const { userInfo, userRole, userType } = validation.data;
    const organizationID = body.organizationID;
    const authHeader =
      event.headers?.Authorization ||
      event.headers?.authorization ||
      event.headers?.AUTHORIZATION;

    if (organizationID) {
      const org = await getOrganization(organizationID, authHeader);
      if (!org) {
        const duration = Date.now() - startTime;
        logHttpRequest(
          logger,
          event.httpMethod || 'POST',
          event.path || '/users',
          400,
          duration,
          correlationId,
        );
        return ApiResponse.badRequest(
          'ORGANIZATION.NOT_FOUND',
          { requestId: correlationId, event },
          {
            code: 'ORGANIZATION_NOT_FOUND',
            details: [
              {
                message: 'Organization does not exist',
                field: 'organizationID',
              },
            ],
          },
        );
      }
      const status = org.status ? String(org.status).toLowerCase() : '';
      if (['on_hold', 'disabled', 'not_exist'].includes(status)) {
        const duration = Date.now() - startTime;
        logHttpRequest(
          logger,
          event.httpMethod || 'POST',
          event.path || '/users',
          400,
          duration,
          correlationId,
        );
        return ApiResponse.badRequest(
          'ORGANIZATION.NOT_AVAILABLE',
          { requestId: correlationId, event },
          {
            code: 'ORGANIZATION_NOT_AVAILABLE',
            details: [
              {
                message: 'Organization is not available',
                field: 'organizationID',
              },
            ],
          },
        );
      }
    }

    const roleIds = Array.isArray(userRole)
      ? userRole.map((roleId) => String(roleId))
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
      logger.info({
        event: 'createUser_fetch_definedRoleCode_from_repo',
        organizationID: body.organizationID,
        roleIds,
        firstRoleId: roleIds[0],
      });
      try {
        const rolePermissions = await userRepository.getRolePermissions(
          roleIds[0],
          body.organizationID,
        );
        logger.info({
          event: 'createUser_repo_query__result',
          rolePermissionsCount: rolePermissions?.length || 0,
          hasItems: rolePermissions && rolePermissions.length > 0,
        });
        if (rolePermissions && rolePermissions.length > 0) {
          const exactRoleMatch =
            rolePermissions.find(
              (item: any) => item.SK === `ROLE#${roleIds[0]}`,
            ) || rolePermissions[0];
          logger.info({
            event: 'createUser_role_detail_found',
            hasExactMatch: exactRoleMatch?.SK === `ROLE#${roleIds[0]}`,
            roleDetailKeys: exactRoleMatch ? Object.keys(exactRoleMatch) : [],
            hasDefinedRoleCode: exactRoleMatch?.definedRoleCode !== undefined,
          });
          definedRoleCode = exactRoleMatch?.definedRoleCode;
          const roleName = exactRoleMatch?.roleName;
          userData.roleName = roleName || definedRoleCode || '';

          const hasExistingFeatures =
            Array.isArray((exactRoleMatch as any)?.features) &&
            (exactRoleMatch as any).features.length > 0;

          if (definedRoleCode === 'ADMIN' && !hasExistingFeatures) {
            const orgAuthHeader =
              event.headers?.Authorization || event.headers?.authorization;
            const orgFeatures = await packagRepository.getOrgFeatures(
              body.organizationID,
              orgAuthHeader,
            );
            if (orgFeatures && orgFeatures.length > 0) {
              const { roleId, roleName, roleDescription, roleType } =
                exactRoleMatch as any;
              await roleRepository.saveRoles(
                body.organizationID,
                roleId,
                roleName,
                roleDescription,
                roleType,
                orgFeatures,
                orgAuthHeader,
              );
            }
          }
          logger.info({
            event: 'createUser_definedRoleCode_from_repo',
            found: !!definedRoleCode,
            definedRoleCode,
            definedRoleCodeType: typeof definedRoleCode,
          });
        } else {
          logger.warn({
            event: 'createUser_repo_no_items',
            message: 'Repository query returned no items',
            roleId: roleIds[0],
            organizationID: body.organizationID,
          });
        }
      } catch (err) {
        logger.error({
          event: 'createUser_definedRoleCode_repo_error',
          err: serializeError(err),
          roleId: roleIds[0],
          organizationID: body.organizationID,
        });
      }
    } else {
      logger.warn({
        event: 'createUser_role_missing',
        organizationID: body.organizationID,
        userType: userTypeUpper,
      });
    }
    logger.info({
      event: 'createUser_definedRoleCode',
      definedRoleCode,
      willSetInUserData: !!definedRoleCode,
    });
    if (definedRoleCode !== undefined && definedRoleCode !== null) {
      userData.definedRoleCode = String(definedRoleCode);
      logger.info({
        event: 'createUser_definedRoleCode_set',
        definedRoleCode: userData.definedRoleCode,
        userDataHasDefinedRoleCode: userData.definedRoleCode !== undefined,
      });
    } else {
      logger.warn({
        event: 'createUser_definedRoleCode_not_set',
        message:
          'definedRoleCode is empty/undefined, not setting in userData',
        definedRoleCode,
      });
    }

    logger.info({
      event: 'createUser_userData_before_service',
      userDataKeys: Object.keys(userData),
      hasDefinedRoleCode: userData.definedRoleCode !== undefined,
      definedRoleCode: userData.definedRoleCode,
    });
    const rolePermissions = await userRepository.getRolePermissions(
      roleIds[0],
      body.organizationID,
    );
    if (rolePermissions && rolePermissions.length > 0) {
      const exactRoleMatch =
        rolePermissions.find(
          (item: any) => item.SK === `ROLE#${roleIds[0]}`,
        ) || rolePermissions[0];
      userData.roleName = exactRoleMatch?.roleName || '';
    }
    const result = await userService.createUser(
      userData,
      userData.roleName,
      body.organizationID,
      body.userID,
      correlationId,
      authHeader,
      body?.userInfo?.friendNFamily,
      body?.userInfo?.assignDoctor,
    );

    if (roleIds.length > 0) {
      logger.info({
        event: 'createUser_assign_user_role_start',
        organizationID: body.organizationID,
        userID: result.userID,
        roleId: roleIds[0],
      });

      try {
        const roleAssignmentResult = await assignUserRole(
          roleIds[0],
          body.organizationID,
          result.userID,
          userInfo.name,
          userInfo.contact.email ?? '',
          userInfo.contact.phone ?? '',
          userInfo.profilePic,
          authHeader,
        );

        if (!roleAssignmentResult || roleAssignmentResult.success === false) {
          logger.error({
            event: 'createUser_assign_user_role_failed',
            organizationID: body.organizationID,
            userID: result.userID,
            roleId: roleIds[0],
            result: roleAssignmentResult,
          });
        } else {
          logger.info({
            event: 'createUser_assign_user_role_success',
            organizationID: body.organizationID,
            userID: result.userID,
            roleId: roleIds[0],
          });
        }
      } catch (err) {
        logger.error({
          event: 'createUser_assign_user_role_exception',
          err: serializeError(err),
          organizationID: body.organizationID,
          userID: result.userID,
          roleId: roleIds[0],
        });
      }
    } else {
      logger.info({
        event: 'createUser_assign_user_role_skipped',
        organizationID: body.organizationID,
        userID: result.userID,
      });
    }
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      event.path || '/users',
      201,
      duration,
      correlationId,
    );

    return ApiResponse.created(
      { invitedUser: result.userID },
      'USER.USER_CREATED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserAlreadyExistsError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'POST',
        event.path || '/users',
        409,
        duration,
        correlationId,
      );
      return ApiResponse.conflict(
        'USER.USER_ALREADY_EXISTS',
        { requestId: correlationId, event },
        {
          code: 'USER_ALREADY_EXISTS',
          details: [{ message: err.message }],
        },
      );
    }
    logger.error({ event: 'createUser_error', err: serializeError(err) });
    logHttpRequest(
      logger,
      event.httpMethod || 'POST',
      event.path || '/users',
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.CREATE_USER_FAILED',
      { requestId: correlationId, event },
      {
        code: 'CREATE_USER_FAILED',
        details: [
          { message: (err as Error)?.message || 'Unknown error' },
        ],
      },
    );
  }
}

export const main: APIGatewayProxyHandler = async (
  event,
  context: Context,
) => {
  return createUser(event, context);
};

