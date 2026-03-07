import { RelationType, UserType } from "@api-hub/utils";
import { UserFactory } from "../factories/user-factory";
import { UserRequestModel } from "../models/user/UserDTO";

export class UserEntityBuilder {

  static buildUserEntity({
    userData,
    userType,
    definedRoleCode,
    organizationID,
    invitedBy,
    userRole,
    userInfo
  }: {
    userData: any
    userType: string
    definedRoleCode?: string
    organizationID: string
    invitedBy?: string
    userRole: string | string[]
    userInfo: any
  }): UserRequestModel {

    const userTypeUpper = String(userType || "").toUpperCase();

    let user: UserRequestModel;

    if (
      definedRoleCode === RelationType.FRIEND ||
      definedRoleCode === RelationType.FAMILY ||
      userTypeUpper === RelationType.FNF
    ) {

      user = UserFactory.createFnF({
        ...userData,
        organizationID,
      });

    } else if (
      userTypeUpper === UserType.STAFF ||
      userTypeUpper === UserType.ADMIN
    ) {

      user = UserFactory.createStaff({
        ...userData,
        organizationID,
      });

    } else if (
      definedRoleCode === RelationType.DOCTOR ||
      userTypeUpper === RelationType.DOCTOR
    ) {

      user = UserFactory.createDoctor(userData, {
        invitedBy,
        code: userData.code,
        userCat: [definedRoleCode || "DOCTOR"],
        isRpmUser: userData.isRpmUser,
      }) as UserRequestModel;

    } else {

      user = UserFactory.createPatient({
        ...userData,
        organizationID,
      });
    }

    const code = (userInfo?.code as string) || "";

    return {
      ...user,
      invitedBy: invitedBy || "",
      inviteCode: code ? `INVITE#${code}` : undefined,
      invitedID: code || undefined,
      logoutRequired: false,
      ...(definedRoleCode !== undefined && definedRoleCode !== null
        ? { definedRoleCode: String(definedRoleCode) }
        : {}),
    };
  }
}