import { createChildLogger, createLogger } from "@api-hub/observability";
import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from "@api-hub/utils";
import { publishUserCreatedEvent } from "../events/UserCreated";
import { UserRepository } from "../repositories/user.repository";
import { CreateUserService } from "../services/create_user";
import { getOrganization } from "../services/organization.service";
import { assignUserRole } from "../services/role.service";
import { UserValidationService } from "../validation/user-validation";

const userService = new CreateUserService();
const userRepository = new UserRepository();
const baseLogger = createLogger({ service: "user-service", redactPII: true });

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
  const handlerStart = Date.now();
  const log = createChildLogger(baseLogger, { correlationId, organizationID, invitedBy: userID });

  if (organizationID) {
    const orgValidationStart = Date.now();
    const org = await getOrganization(organizationID, authHeader, {
      minimal: true,
    });
    if (!org) {
      throwOrgError("Organization does not exist", "ORGANIZATION_NOT_FOUND");
    }
    const status = org?.status ? String(org?.status).toLowerCase() : "";
    if (["on_hold", "disabled", "not_exist"].includes(status)) {
      throwOrgError(
        "Organization is not available",
        "ORGANIZATION_NOT_AVAILABLE"
      );
    }
    log.info({
      event: "create_user_org_validation_timing",
      durationMs: Date.now() - orgValidationStart,
    });
  }

  const roleIds = UserValidationService.normalizeRoleIds(userRole);
  let roleName: string | undefined;
  let definedRoleCode: string | undefined;

  if (roleIds.length > 0) {
    const roleLookupStart = Date.now();
    const rolePermissions = await userRepository
      .getRolePermissions(roleIds[0], organizationID)
      .catch(() => []);
    if (rolePermissions && rolePermissions.length > 0) {
      const exactRoleMatch =
        rolePermissions.find(
          (item: any) =>
            item.SK === `ROLE#${roleIds[0]}` || item.sk === `ROLE#${roleIds[0]}`
        ) || rolePermissions[0];
      definedRoleCode = exactRoleMatch?.definedRoleCode;
      roleName = exactRoleMatch?.roleName || definedRoleCode || "";
      if (
        definedRoleCode === "ADMIN" &&
        !(Array.isArray((exactRoleMatch as any)?.features) && (exactRoleMatch as any).features.length > 0)
      ) {
        // Keep request fast: ADMIN feature bootstrap should happen in async worker flow.
      }
    }
    log.info({
      event: "create_user_role_lookup_timing",
      durationMs: Date.now() - roleLookupStart,
    });
  }

  const serviceCallStart = Date.now();
  const result = await userService.createUser({
    userInfo,
    userRole,
    userType,
    userID,
    organizationID,
    correlationId,
    authHeader: authHeader ?? "",
    friendNFamily: body?.userInfo?.friendNFamily,
    assignDoctor: body?.userInfo?.assignDoctor,
    roleName,
    definedRoleCode,
    // Optional SSO / external metadata forwarded to Cognito as custom attributes
    providerId: body.providerId ?? body.provider,
    externalUserId: body.externalUserId ?? body.externalId,
    subdomain: body.subdomain ?? body.subDomain,
    organizationExternalId:
      body.organizationExternalId ??
      body.organizationExternalID ??
      body.organizationId ??
      body.tenantId,
    skipOrganizationValidation: true,
  });
  log.info({
    event: "create_user_core_create_timing",
    userId: result.userID,
    durationMs: Date.now() - serviceCallStart,
  });

  const userCreatedEventStart = Date.now();
  try {
    await publishUserCreatedEvent({
      eventName: "UserCreated.v1",
      correlationId: correlationId ?? "",
      userId: result.userID,
      email: userInfo?.contact?.email ?? "",
      name: userInfo?.name ?? userInfo?.fullName ?? "",
      organizationId : organizationID,
    });
    log.info({
      event: "create_user_user_created_event_published",
      userId: result.userID,
      durationMs: Date.now() - userCreatedEventStart,
    });
  } catch (err: any) {
    log.warn({
      event: "create_user_user_created_event_failed",
      userId: result.userID,
      durationMs: Date.now() - userCreatedEventStart,
      error: err?.message || String(err),
    });
  }

  if (roleIds.length > 0) {
    const roleAssignmentStart = Date.now();
    const syncRoleAssignmentEnabled =
      String((globalThis as any)?.process?.env?.CREATE_USER_SYNC_ROLE_ASSIGNMENT || "").toLowerCase() === "true";
    const assignRolePromise = assignUserRole(
      roleIds[0],
      organizationID,
      result.userID,
      userInfo.name,
      userInfo.contact?.email ?? "",
      userInfo.contact?.phone ?? "",
      userInfo.profilePic,
      authHeader
    )
      .then(() => {
        log.info({
          event: "create_user_assignUserRole_success",
          userId: result.userID,
          mode: syncRoleAssignmentEnabled ? "sync" : "async",
          durationMs: Date.now() - roleAssignmentStart,
        });
      })
      .catch(() => {
        log.warn({
          event: "create_user_assignUserRole_failed",
          userId: result.userID,
          mode: syncRoleAssignmentEnabled ? "sync" : "async",
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
    event: "create_user_handler_total_timing",
    userId: result.userID,
    durationMs: Date.now() - handlerStart,
  });

  return { invitedUser: result.userID };
};

export const main = withApiHandler({ operation: 'createUser' }, handler);