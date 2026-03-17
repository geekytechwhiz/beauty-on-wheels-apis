import {
  createChildLogger,
  createLogger,
  createPerformanceTimer,
  serializeError,
} from "@api-hub/logger";
import { ulid } from "ulid";

import { CreateUserHandlerModel } from "../models/user/create-user-model";
import { UserRequestModel } from "../models/user/UserDTO";

import { CognitoUserService, RoleServiceClient } from "@api-hub/service-clients";

import { buildUserData } from "../domain/user.builder";
import { UserFactory } from "../factories/user-factory";

import { handleDoctorAssignment } from "../processors/doctor.processor";
import { handleFriendFamilyLink } from "../processors/fnf.processor";

import { UserRepositoryV2 } from "../repositories/user.repository-v2";
import { UserValidationService } from "../validation/user-validation";
import { getOrganization } from "./organization.service";
import { notifyUser } from "./notification.service";
import { RelationType, UserType } from "@api-hub/utils";

export class CreateUserService {

  private baseLogger = createLogger({ service: "user-service", redactPII: true });

  private cognitoUserService = new CognitoUserService();
  private repository = new UserRepositoryV2();
  private roleServiceClient = new RoleServiceClient();

  async createUser(input: CreateUserHandlerModel): Promise<UserRequestModel> {

    const {
      userInfo,
      userType,
      organizationID,
      correlationId,
      authHeader,
      userRole,
      userID,
      friendNFamily,
      assignDoctor,
      roleName: inputRoleName,
      definedRoleCode: inputDefinedRoleCode,
      providerId,
      externalUserId,
      subdomain,
      organizationExternalId,
    } = input;

    const invitedBy = userID;

    const timer = createPerformanceTimer(
      this.baseLogger,
      "createUser",
      correlationId
    );

    const log = createChildLogger(this.baseLogger, {
      correlationId,
      organizationID,
    });

    log.info({ event: "createUser_start" });

    try {
      await UserValidationService.validateOrganization(
        organizationID,
        authHeader
      );

      const orgDetails = await getOrganization(organizationID, authHeader);
      if (!orgDetails) {
        const err: any = new Error("Organization does not exist");
        err.statusCode = 400;
        err.code = "ORGANIZATION_NOT_FOUND";
        throw err;
      }

      let roleName = inputRoleName;
      let definedRoleCode = inputDefinedRoleCode;
      if (roleName === undefined || definedRoleCode === undefined) {
        const roleDetailsRaw: any = await this.roleServiceClient.getRoleDetails(
          userRole as string | string[],
          organizationID,
          authHeader
        );
        const roleDetails = Array.isArray(roleDetailsRaw)
          ? roleDetailsRaw[0]
          : roleDetailsRaw;
        if (roleName === undefined) {
          roleName = roleDetails?.roleName ?? "";
        }
        if (definedRoleCode === undefined) {
          definedRoleCode = roleDetails?.definedRoleCode;
        }
      }

      const newUserId =
        (userInfo?.code as string)?.trim() || ulid();

      const userData = buildUserData(userInfo, userType, userRole);
      userData.userID = newUserId;

      await this.cognitoUserService.createUser(
        {
          email: userData.emailAddress,
          phoneNumber: userData.phoneNumber,
          phoneCode: userData.phoneCode,
          username: userData.username,
          userType: userData.userType,
          userID: newUserId,
          organizationID,
          roleName: roleName ?? undefined,
          permissions: [],
          // SSO / external metadata for Cognito custom attributes
          providerId,
          externalUserId,
          subdomain,
          organizationExternalId,
          role: (definedRoleCode ?? userType)?.toString().toLowerCase(),
        },
        log
      );

      let user: UserRequestModel;

      const roleCode = definedRoleCode;
      const userTypeUpper = String(userType || "").toUpperCase();

      if (
        roleCode === RelationType.FRIEND ||
        roleCode === RelationType.FAMILY ||
        userTypeUpper === RelationType.FNF
      ) {
        user = UserFactory.createFnF({
          ...userData,
          organizationID,
        });
      } else if (userTypeUpper === UserType.STAFF || userTypeUpper === UserType.ADMIN) {
        user = UserFactory.createStaff({
          ...userData,
          organizationID,
        });
      } else if (roleCode === RelationType.DOCTOR || userTypeUpper === RelationType.DOCTOR) {
        user = UserFactory.createDoctor(userData, {
          invitedBy,
          code: userData.code,
          userCat: userRole as string[],
          isRpmUser: userData.isRpmUser,
        }) as UserRequestModel;
      } else {
        user = UserFactory.createPatient({
          ...userData,
          organizationID,
        });
      }

      const code = (userInfo?.code as string) || "";
      const userForDb: UserRequestModel = {
        ...user,
        invitedBy: invitedBy || "",
        inviteCode: code ? `INVITE#${code}` : undefined,
        invitedID: code || undefined,
        logoutRequired: false,
        ...(definedRoleCode !== undefined && definedRoleCode !== null
          ? { definedRoleCode: String(definedRoleCode) }
          : {}),
      };

      await this.repository.createUser(userForDb);

      await this.repository.assignUserToOrganization(userForDb);

      await handleFriendFamilyLink(
        userForDb,
        friendNFamily,
        organizationID,
        authHeader,
        log
      );

      await handleDoctorAssignment(
        userForDb,
        assignDoctor,
        organizationID,
        log
      );

      try {
        const userTypeUpperNotify = String(userForDb.userType || "").toUpperCase();
        const isStaff = userTypeUpperNotify === "STAFF";
        const template = isStaff ? "WELCOME_STAFF" : "WELCOME_USER";

        const phoneRaw =
          (userForDb.phoneNumber && String(userForDb.phoneNumber).trim()) ||
          (userInfo?.contact as any)?.phone ||
          "";
        const phoneCodeRaw = String(
          userForDb.phoneCode || (userInfo?.contact as any)?.phoneCode || ""
        ).trim();
        let notifyPhone: string | undefined;
        if (phoneRaw) {
          if (phoneCodeRaw) {
            notifyPhone = phoneCodeRaw.startsWith("+")
              ? `${phoneCodeRaw}${phoneRaw}`
              : `+${phoneCodeRaw}${phoneRaw}`;
          } else {
            notifyPhone = phoneRaw.startsWith("+") ? phoneRaw : `+${phoneRaw}`;
          }
        }

        const deviceToken =
          (userForDb as any).deviceToken || (userForDb as any).device;
        const channels = [
          ...(userForDb.emailAddress ? ["email"] : []),
          ...(notifyPhone ? ["sms"] : []),
          ...(deviceToken ? ["push"] : []),
        ];

        const orgAddress =
          orgDetails?.organizationAddress ||
          (orgDetails as any)?.address ||
          "";
        const adminInfo = (orgDetails as any)?.adminDetails;
        let orgInfo = "";
        if (adminInfo) {
          const adminName = (adminInfo as any)?.adminName || "";
          const adminEmail = (adminInfo as any)?.emailAddress || "";
          orgInfo = `${adminName}${adminName && adminEmail ? "<br>" : ""}${adminEmail}`;
        } else {
          const orgEmail = (orgDetails as any)?.emailAddress || "";
          const orgPhoneCode =
            (orgDetails as any)?.phoneCode || (orgDetails as any)?.phoneCode || "";
          const orgPhoneNumber =
            (orgDetails as any)?.phoneNumber ||
            (orgDetails as any)?.phoneNumb ||
            "";
          const orgPhone =
            orgPhoneCode && orgPhoneNumber
              ? `${orgPhoneCode}${orgPhoneNumber}`
              : orgPhoneNumber || "";
          orgInfo = `${orgEmail}${orgEmail && orgPhone ? "<br>" : ""}${orgPhone}`;
        }

        const baseTemplateData: Record<string, unknown> = {
          userType: userForDb.userType,
          mrn: (userForDb as any).mrn,
          ORG_NAME:
            (orgDetails as any)?.name ||
            (orgDetails as any)?.organizationInfo?.organizationName ||
            (orgDetails as any)?.organizationInfo?.name ||
            "",
          ORG_INFO: orgInfo,
        };

        const templateData: Record<string, unknown> = { ...baseTemplateData };
        if (userTypeUpperNotify === "STAFF") {
          Object.assign(templateData, {
            STAFF_FIRST_NAME: userForDb.firstName,
            PORTAL_LINK: process.env.PORTAL_LINK || "",
            ORG_ADDRESS: orgAddress,
          });
        } else if (userTypeUpperNotify === "FNF") {
          Object.assign(templateData, {
            WEB_DNS_URL:
              process.env.WEB_URL || process.env.WEB_DNS_URL || "",
            HOSPITAL_ID: (orgDetails as any)?.organizationID || "",
            TYPE: channels.includes("email") ? "email" : channels.includes("sms") ? "sms" : "",
            DEVICE: deviceToken ? "&rpm=true" : "",
            ORG_ADDRESS: orgAddress,
            FNF_FIRST_NAME: userForDb.firstName,
            USER_NAME:
              userForDb.fullName ||
              `${userForDb.firstName || ""} ${userForDb.lastName || ""}`.trim(),
          });
        } else {
          Object.assign(templateData, {
            WEB_DNS_URL:
              process.env.WEB_URL || process.env.WEB_DNS_URL || "",
            HOSPITAL_ID: (orgDetails as any)?.organizationID || "",
            TYPE: channels.includes("email") ? "email" : channels.includes("sms") ? "sms" : "",
            DEVICE: deviceToken ? "&rpm=true" : "",
            ORG_ADDRESS: orgAddress,
            USER_FIRST_NAME: userForDb.firstName,
          });
        }

        const definedRoleCodeForNotify = String(
          (userForDb as any).definedRoleCode || ""
        ).toUpperCase();
        const isFnfRole =
          definedRoleCodeForNotify === "FRIEND" ||
          definedRoleCodeForNotify === "FAMILY";

        if (isFnfRole) {
          log.info({
            event: "createUser_notification_skipped",
            condition: "fnf_role",
            definedRoleCode: definedRoleCodeForNotify,
            message:
              "Notification skipped for FRIEND/FAMILY role; no email or SMS sent",
          });
        } else {
          log.info({
            event: "createUser_notifyUser_calling",
            userId: userForDb.userID,
            channels,
            template,
            message: "Publishing UserCreatedNotificationRequested to SNS",
          });
          await notifyUser({
            userId: userForDb.userID,
            email: userForDb.emailAddress,
            phone: notifyPhone,
            name: userForDb.fullName ?? userForDb.firstName ?? "",
            deviceToken,
            channels,
            template,
            templateData,
            correlationId,
          });
        }
      } catch (notifyErr) {
        log.warn({
          event: "createUser_notification_failed",
          err: serializeError(notifyErr),
          userId: userForDb.userID,
          message:
            "notifyUser threw; check USER_EVENTS_TOPIC_ARN and SNS permissions",
        });
      }

      log.info({ event: "createUser_success" });

      return userForDb;

    } catch (err) {

      log.error({
        event: "createUser_error",
        err: serializeError(err),
      });

      throw err;

    } finally {

      timer.end();

    }
  }
}