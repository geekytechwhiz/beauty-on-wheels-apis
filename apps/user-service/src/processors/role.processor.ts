import { RoleNotFoundError } from "../errors/user-errors";
import { PackageRepository } from "../repositories/package.repositrory";
import { RoleRepository } from "../repositories/role.repository";

export async function resolveRoleDetails(
    userRole: string | string[],
    organizationID: string,
    authHeader?: string
  ) {

    const roleRepository = new RoleRepository();
    const packageRepository = new PackageRepository();
    const roleIds = Array.isArray(userRole) ? userRole : [userRole];
    const primaryRoleId = roleIds[0];

    if (!primaryRoleId) {
      return {};
    }

    const rolePermissions =
      await roleRepository.getRolePermissions(primaryRoleId, organizationID);

    if (!rolePermissions?.length) {
      throw new RoleNotFoundError(primaryRoleId)
    }

    const role =
      rolePermissions.find(
        (item: any) =>
          item.SK === `ROLE#${primaryRoleId}` ||
          item.sk === `ROLE#${primaryRoleId}`
      ) ?? rolePermissions[0];

    const definedRoleCode = role?.definedRoleCode;
    const roleName = role?.roleName || definedRoleCode || "";

    const hasExistingFeatures =
      Array.isArray(role?.features) && role.features.length > 0;

    if (definedRoleCode === "ADMIN" && !hasExistingFeatures) {

      const orgFeatures =
        await packageRepository.getOrgFeatures(organizationID, authHeader);

      if (orgFeatures?.length) {

        const {
          roleId,
          roleName: rn,
          roleDescription,
          roleType,
        } = role;

        await roleRepository.saveRoles(
          organizationID,
          roleId,
          rn,
          roleDescription,
          roleType,
          orgFeatures,
          authHeader
        );
      }
    }

    return {
      roleName,
      definedRoleCode
    };
  }