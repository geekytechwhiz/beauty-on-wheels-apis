import { createChildLogger, serializeError } from '@api-hub/observability';
import { BaseClient } from '@api-hub/service-clients';
import axios from 'axios';
import { SSORequestContext } from '../types/common/context.types';
import { PendingAppointment } from '../types/domain/appointment.types';
import { SSOError } from '../types/errors/sso-error';
import {
  AssignDoctorPayload,
  DoctorCreationPayload,
  PatientCreationPayload,
} from '../types/user-creation.type';
import { CreatedUserInfo, User } from '../types/user/user.types';
import { baseLogger, getOrganizationId } from '../utils/helper';
import { buildHeaders } from '../utils/request.utils';
import { CognitoService } from '../services/cognito.service';
import { UserExistenceValidator } from '../validators/user-existence.validator';

export class SSOUserServiceClient extends BaseClient {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'SSOUserServiceClient',
  });
  constructor() {
    super(process.env.USER_SERVICE_BASE_URL || '', 'user-service');
  }
  async findUserByExternalId(
    params: { externalId: string },
    context: SSORequestContext,
  ): Promise<User | null> {
    const externalUserId = params.externalId;
    const subdomain = context.integration.subdomain;

    this.logger.info({
      event: 'findUserByExternalId_lookup',
      externalUserId,
      subdomain,
      provider: context.integration.providerId,
    });

    try {
      const response = await this.client.get<{ data?: User } | User>('/users/external', {
        params: {
          tenant: subdomain,
          provider: context.integration.providerId,
          externalUserId,
        },
        headers: buildHeaders(context),
      });

      // User-service returns { success, data, message, error, meta }; user is in data
      type ExternalResponse = { data?: { userID?: string; emailAddress?: string; organizationID?: string; externalIdentity?: { externalUserId?: string; subdomain?: string; provider?: string }; [k: string]: unknown } };
      const body = response.data as ExternalResponse | null;
      const userPayload = body?.data ?? null;

      // User-service model uses userID; SSO expects id
      const userId = (userPayload?.userID ?? userPayload?.id) as string | undefined;
      if (!userId) {
        this.logger.info({
          event: 'findUserByExternalId_service_not_found',
          externalUserId,
          subdomain,
          provider: context.integration.providerId,
        });
        return null;
      }

      this.logger.info({
        event: 'findUserByExternalId_success',
        externalUserId,
        userId,
        provider: context.integration.providerId,
      });

      // Normalize to SSO User: user-service uses userID, emailAddress, organizationID, externalIdentity
      const ext = userPayload?.externalIdentity as { externalUserId?: string; subdomain?: string; provider?: string } | undefined;
      const created = userPayload?.createdDate ?? userPayload?.modifiedDate;
      const externalUserIdVal = ext?.externalUserId ?? externalUserId;
      return {
        ...userPayload,
        id: userId,
        invitedUser: userId,
        email: userPayload?.email ?? userPayload?.emailAddress,
        organizationId: userPayload?.organizationId ?? userPayload?.organizationID,
        externalId: externalUserIdVal,
        tenantId: ext?.subdomain ?? subdomain,
        provider: ext?.provider ?? context.integration.providerId,
        status: userPayload?.isActive === true ? 'ACTIVE' : userPayload?.isActive === false ? 'INACTIVE' : 'ACTIVE',
        createdAt: created != null ? String(created) : new Date().toISOString(),
        updatedAt: userPayload?.modifiedDate != null ? String(userPayload.modifiedDate) : new Date().toISOString(),
        externalUserId: externalUserIdVal,
      } as unknown as User;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // console.log('findUserByExternalId error', serializeError(error as Error));
        return null;
      }

      // console.log('findUserByExternalId error', serializeError(error as Error));

      throw SSOError.userServiceError(
        'User service doctor lookup failed',
        error as Error,
      );
    }
  }

  async createDoctor(
    payload: DoctorCreationPayload,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
    // console.log('createDoctor payload', JSON.stringify(payload));

    const response = await this.client.post<unknown>('/user', payload, {
      headers: buildHeaders(context),
    });

    // console.log('createDoctor response', response);
    const body:any = response?.data ?? response;
    // console.log('createDoctor body', body);
    const invitedUser: string | undefined =
      body?.data?.invitedUser ??
      body?.data?.id ??
      body?.data?.userId ??
      body?.data?.userID;

    const rawUserId = invitedUser;

    if (!rawUserId) {
      this.logger.error({
        event: 'createDoctor_user_id_missing',
        subdomain: context.integration.subdomain,
        externalUserId: payload.externalIdentity?.externalUserId,
        responseBody: body,
        provider: context.integration.providerId,
      });

      throw SSOError.userServiceError(
        'User service did not return invitedUser identifier for created doctor',
        new Error('Missing invitedUser in createDoctor response'),
      );
    }

    const emailFromPayload =
      payload.email ?? payload.userInfo?.contact?.email ?? null;

    const result: CreatedUserInfo = {
      userId: String(rawUserId),
      email: emailFromPayload,
      externalUserId: payload.externalIdentity?.externalUserId  ,
      organizationId: payload.organizationID,  
    };

    this.logger.info({
      event: 'createDoctor_success',
      externalUserId: result.externalUserId,
      userId: result.userId,
      provider: context.integration.providerId,
    });

    return result;
  }

  async createDoctorWithRetry(
    payload: DoctorCreationPayload,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
    const subdomain = context.integration.subdomain;
    const externalUserId = payload.externalIdentity?.externalUserId;
    const logBase = { externalUserId, subdomain };

    try {
      return await this.createDoctor(payload, context);
    } catch (err) {
      if ((err as any).code === 'ECONNABORTED') {
        this.logger.warn({
          event: 'createDoctor_timeout_retry',
          ...logBase,
          retryAttempt: 1,
          provider: context.integration.providerId,
        });
        return this.createDoctor(payload, context);
      }

      if (
        axios.isAxiosError(err) &&
        err.response?.status === 409 &&
        externalUserId
      ) {
        this.logger.info({
          event: 'createDoctor_conflict_fetching_existing',
          ...logBase,
          retryAttempt: 0,
          provider: context.integration.providerId,
        });
        const userExistenceValidator = new UserExistenceValidator(
          this,
          new CognitoService(),
          this.logger,
        );
        const existenceResult = await userExistenceValidator.checkUserExists(
          { externalId: externalUserId, email: payload.email ?? null, phone: payload.userInfo?.contact?.phone ?? null },
          context,
        );

        if (existenceResult.userServiceUser) {
          this.logger.info({
            event: 'createDoctor_conflict_resolved_existing',
            ...logBase,
            doctorUserId: existenceResult.userServiceUser.id,
            provider: context.integration.providerId,
          });
          const organizationId = getOrganizationId(subdomain);
          return {
              userId: String(existenceResult.userServiceUser.id),
            email:
              existenceResult.userServiceUser.email ??
              payload.email ??
              payload.userInfo?.contact?.email ??
              null,
            externalUserId,
            organizationId,
          };
        }

        console.warn('createDoctor_conflict_no_existing_user_found', {
          ...logBase,
        });
      }

      throw err;
    }
  }

  async createPatient(
    payload: PatientCreationPayload,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
    const subdomain = context.integration.subdomain;
    const externalUserId = payload.externalIdentity?.externalUserId;
    const organizationId = getOrganizationId(subdomain);

    // console.log('createPatient payload', JSON.stringify(payload));
    const patientCreationPayload = {
      ...payload,
      organizationId: organizationId,
      subdomain: subdomain,
    };
    
    const response = await this.client.post<{ data: User }>('/user', patientCreationPayload, {
      headers: buildHeaders(context),
    });

    const user = response.data.data;
    // console.log('createPatient user', user);

    return {
      userId: String(user?.invitedUser),
      email: user.email,
      externalUserId: externalUserId,
      organizationId,
    } as CreatedUserInfo;
  }

  /**
   * Assigns a patient (receiver) to a doctor (sender) in an organization.
   * Wraps the `/user/assign-doctor` endpoint with SSO error handling.
   */
  async assignDoctor(
    payload: AssignDoctorPayload,
    context: SSORequestContext,
  ): Promise<{ message: string }> {
    try {
      const response = await this.client.post<{ message: string }>(
        '/user/assign-doctor',
        payload,
        { headers: buildHeaders(context) },
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const messageFromServer =
          (error.response?.data as any)?.message ||
          (status === 400
            ? 'Assign doctor request is invalid'
            : status === 404
              ? 'Doctor or patient not found'
              : 'Assign doctor request to user service failed');

        throw SSOError.userServiceError(messageFromServer, error);
      }

      throw SSOError.userServiceError(
        'Assign doctor request to user service failed',
        error as Error,
      );
    }
  }
  async storePendingAppointment(
    tenantId: string,
    pending: PendingAppointment,
    context: SSORequestContext,
  ): Promise<void> {
    try {
      const organizationID =
        pending.organizationID ?? getOrganizationId(context.integration.subdomain);

      const requestBody = {
        appointmentId:
          pending.appointmentId ?? `appt-${pending.externalAppointmentId}`,
        externalAppointmentId: pending.externalAppointmentId,
        tenantId: pending.tenantId ?? tenantId,
        organizationID,
        patientUserId: pending.patientUserId ?? pending.patientExternalId,
        doctorUserId: pending.doctorUserId ?? pending.doctorExternalId,
        patientExternalId: pending.patientExternalId,
        doctorExternalId: pending.doctorExternalId,
        startTime: new Date(pending.appointment.startTime ?? '').getTime(),
        endTime: new Date(pending.appointment.endTime ?? '').getTime(),
        status: 'PENDING',
        sourceSystem: context.sourceSystem,
      };

      await this.client.post(
        '/pending-appointments',
        requestBody,
        { headers: buildHeaders(context) },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 409) {
          this.logger.info({
            event: 'store_pending_appointment_conflict_skipped',
            tenantId,
            externalAppointmentId: pending.externalAppointmentId,
            patientExternalId: pending.patientExternalId,
          });
          return;
        }
        this.logger.error({
          event: 'store_pending_appointment_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Store pending appointment failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Store pending appointment failed',
        error as Error,
      );
    }
  }

}

export function getSSOUserServiceClient(): SSOUserServiceClient {
  return new SSOUserServiceClient();
}
