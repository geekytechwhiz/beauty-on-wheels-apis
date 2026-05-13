import {
  createChildLogger,
  createLogger,
  createPerformanceTimer,
  serializeError,
} from '@api-hub/observability';
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
      skipOrganizationValidation,
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
    const stepDuration = (stepName: string, startTime: number, meta: Record<string, unknown> = {}) => {
      log.info({
        event: "create_user_step_timing",
        step: stepName,
        durationMs: Date.now() - startTime,
        ...meta,
      });
    };

    log.info({ event: "createUser_start" });

    try {
      let orgDetails: any = null;
      if (!skipOrganizationValidation) {
        const orgValidationStart = Date.now();
        await UserValidationService.validateOrganization(
          organizationID,
          authHeader,
        );
        stepDuration("organization_validation", orgValidationStart);
      }

      const orgFetchStart = Date.now();
      orgDetails = await getOrganization(organizationID, authHeader, {
        minimal: true,
      });
      stepDuration("organization_fetch_minimal", orgFetchStart, { skippedValidation: !!skipOrganizationValidation });
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

      const cognitoCreateStart = Date.now();
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
      stepDuration("cognito_create_user", cognitoCreateStart);

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

      const dbCreateUserStart = Date.now();
      await this.repository.createUser(userForDb);
      stepDuration("db_create_user", dbCreateUserStart);

      const dbAssignOrgStart = Date.now();
      await this.repository.assignUserToOrganization(userForDb);
      stepDuration("db_assign_user_to_org", dbAssignOrgStart);

      const postCreateTasks = async () => {
        const postCreateStart = Date.now();
        const fnfStart = Date.now();
        await handleFriendFamilyLink(
          userForDb,
          friendNFamily,
          organizationID,
          authHeader,
          log
        );
        stepDuration("post_create_friend_family", fnfStart);

        const doctorStart = Date.now();
        await handleDoctorAssignment(
          userForDb,
          assignDoctor,
          organizationID,
          log
        );
        stepDuration("post_create_doctor_assignment", doctorStart);

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
        stepDuration("post_create_total", postCreateStart);
      };

      const syncPostCreateTasks =
        String(process.env.CREATE_USER_SYNC_POST_CREATE_TASKS || "").toLowerCase() === "true";
      if (syncPostCreateTasks) {
        await postCreateTasks();
      } else {
        void postCreateTasks().catch((postCreateErr) => {
          log.warn({
            event: "create_user_post_create_async_failed",
            userId: userForDb.userID,
            err: serializeError(postCreateErr),
          });
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