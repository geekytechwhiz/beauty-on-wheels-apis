import {
  createChildLogger,
  createLogger,
  createPerformanceTimer,
  serializeError,
} from '@api-hub/logger';

import { CreateUserHandlerModel } from '../models/user/create-user-model';
import { UserRequestModel } from '../models/user/UserDTO';
 
import { buildUserData } from '../domain/user.builder';

import { handleDoctorAssignment } from '../processors/doctor.processor';
import { handleFriendFamilyLink } from '../processors/fnf.processor';

import { UserRepositoryV2 } from '../repositories/user.repository-v2';

import { UserValidationService } from '../validation/user-validation';
import { notifyUser } from './notification.service';

import { PhoneHelper, RelationType, TemplateType, UserType } from '@api-hub/utils';
import { UserEntityBuilder } from '../builder/user-entity.builder';
import { resolveRoleDetails } from '../processors/role.processor'; 
import { CognitoService } from '@api-hub/service-clients';

export class CreateUserService {

  private baseLogger = createLogger({
    service: 'user-service',
    redactPII: true,
  });

  private cognitoService = new CognitoService(process.env.DEFAULT_AWS_REGION || 'us-east-1', process.env.COGNITO_USER_POOL_ID || '');
  private repository = new UserRepositoryV2();

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
    } = input;

    const invitedBy = userID;

    const timer = createPerformanceTimer(
      this.baseLogger,
      'createUser',
      correlationId,
    );

    const log = createChildLogger(this.baseLogger, {
      correlationId,
      organizationID,
    });

    log.info({ event: 'createUser_start' });

    let cognitoUser: { username?: string } | null = null;

    try {

      const orgDetails = await UserValidationService.validateOrganization(
        organizationID,
        authHeader,
      );

      const roleData = await resolveRoleDetails(
        userRole,
        organizationID,
        authHeader,
      );

      const roleName = roleData.roleName;
      const definedRoleCode = roleData.definedRoleCode;

      const userData = buildUserData(userInfo, userType, userRole);

      cognitoUser = await this.cognitoService.createUser(
        {
          email: userData.emailAddress,
          phoneNumber: userData.phoneNumber,
          phoneCode: userData.phoneCode,
          username: userData.username,
          userType: userData.userType,
          userID: userData.userID,
          organizationID,
          roleName: roleName ?? undefined,
          permissions: [],
        },
        log,
      );

      const userForDb: UserRequestModel = UserEntityBuilder.buildUserEntity({
        userData,
        userType,
        definedRoleCode,
        organizationID,
        invitedBy,
        userRole,
        userInfo,
      });

      await this.repository.createUser(userForDb);

      await this.repository.assignUserToOrganization(userForDb);

      await handleFriendFamilyLink(
        userForDb,
        friendNFamily,
        organizationID,
        authHeader,
        log,
      );

      await handleDoctorAssignment(
        userForDb,
        assignDoctor,
        organizationID,
        log,
      );

      try {

        const userTypeUpper = String(userForDb.userType || '').toUpperCase();

        const template =
          userTypeUpper === UserType.STAFF
            ? TemplateType.WELCOME_STAFF
            : TemplateType.WELCOME_USER;

        const notifyPhone = PhoneHelper.buildNotifyPhone(
          {
            phoneNumber: userForDb.phoneNumber,
            phoneCode: userForDb.phoneCode,
          },
          userInfo?.contact as
            | { phone?: string; phoneCode?: string }
            | undefined,
        );

        const deviceToken =
          (userForDb as any).deviceToken || (userForDb as any).device;

        const channels = [
          ...(userForDb.emailAddress ? ['email'] : []),
          ...(notifyPhone ? ['sms'] : []),
          ...(deviceToken ? ['push'] : []),
        ];

        const isFnfRole =
          definedRoleCode === RelationType.FRIEND ||
          definedRoleCode === RelationType.FAMILY;

        const templateData = {
          userType: userForDb.userType,
          mrn: (userForDb as any).mrn,
          USER_FIRST_NAME: userForDb.firstName,
          ORG_NAME: orgDetails?.name,
          ORG_ADDRESS: orgDetails?.organizationAddress || '',
          WEB_DNS_URL: process.env.WEB_URL || process.env.WEB_DNS_URL || '',
          HOSPITAL_ID: organizationID,
          TYPE: channels.includes('email')
            ? 'email'
            : channels.includes('sms')
            ? 'sms'
            : '',
          DEVICE: deviceToken ? '&rpm=true' : '',
        };

        if (!isFnfRole) {
          await notifyUser({
            userId: userForDb.userID,
            email: userForDb.emailAddress,
            phone: notifyPhone,
            name: userForDb.fullName ?? userForDb.firstName ?? '',
            deviceToken,
            channels,
            template,
            templateData,
            correlationId,
          });
        }

      } catch (notifyErr) {

        log.warn({
          event: 'createUser_notification_failed',
          err: serializeError(notifyErr),
          userId: userForDb.userID,
        });

      }

      log.info({ event: 'createUser_success' });

      return userForDb;

    } catch (err) {

      log.error({
        event: 'createUser_error',
        err: serializeError(err),
      });

      if (cognitoUser?.username) {

        try {

          await this.cognitoService.deleteUser(
            cognitoUser.username,
            log,
          );

          log.info({
            event: 'cognito_rollback_success',
            username: cognitoUser.username,
          });

        } catch (rollbackErr) {

          log.error({
            event: 'cognito_rollback_failed',
            err: serializeError(rollbackErr),
          });

        }
      }

      throw err;

    } finally {

      timer.end();

    }
  }
}