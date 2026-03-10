import { LambdaRequest } from "@api-hub/utils";
import { CreateUserService } from "../services/create_user";
import { assignUserRole } from "../services/role.service";
import { UserValidationService } from "../validation/user-validation";
import { getOrganization } from "../services/organization.service";
import { UserRepository } from "../repositories/user.repository";
import { PackageRepository } from "../repositories/package.repositrory";
import { RoleRepository } from "../repositories/role.repository";

const userService = new CreateUserService();
const userRepository = new UserRepository();
const packageRepository = new PackageRepository();
const roleRepository = new RoleRepository();

function throwOrgError(message: string, code: string) {
  const err: any = new Error(message);
  err.statusCode = 400;
  err.code = code;
  throw err;
}

export const handler = async (
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
      throwOrgError("Organization does not exist", "ORGANIZATION_NOT_FOUND");
    }
    const status = org?.status ? String(org?.status).toLowerCase() : "";
    if (["on_hold", "disabled", "not_exist"].includes(status)) {
      throwOrgError(
        "Organization is not available",
        "ORGANIZATION_NOT_AVAILABLE"
      );
    }
  }

  const roleIds = UserValidationService.normalizeRoleIds(userRole);
  let roleName: string | undefined;
  let definedRoleCode: string | undefined;

  if (roleIds.length > 0) {
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

      const hasExistingFeatures =
        Array.isArray((exactRoleMatch as any)?.features) &&
        (exactRoleMatch as any).features.length > 0;

      if (definedRoleCode === "ADMIN" && !hasExistingFeatures) {
        const orgFeatures = await packageRepository
          .getOrgFeatures(organizationID, authHeader)
          .catch(() => []);
        if (orgFeatures && orgFeatures.length > 0) {
          const {
            roleId,
            roleName: rn,
            roleDescription,
            roleType,
          } = exactRoleMatch as any;
          await roleRepository
            .saveRoles(
              organizationID,
              roleId,
              rn,
              roleDescription,
              roleType,
              orgFeatures,
              authHeader
            )
            .catch(() => {});
        }
      }
    }
  }

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
  });

  if (roleIds.length > 0) {
    await assignUserRole(
      roleIds[0],
      organizationID,
      result.userID,
      userInfo.name,
      userInfo.contact?.email ?? "",
      userInfo.contact?.phone ?? "",
      userInfo.profilePic,
      authHeader
    ).catch(() => {});
  }

  return { invitedUser: result.userID };
};