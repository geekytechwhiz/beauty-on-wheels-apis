import axios from 'axios';
import { serializeError } from '@api-hub/logger';
import { SSORequestContext } from '../types/common/context.types';
import { SSOError } from '../types/errors/sso-error';
import {
  AssignDoctorPayload,
  DoctorCreationPayload,
  PatientCreationPayload,
} from '../types/user-creation.type';
import { User } from '../types/user/user.types';
import { getOrganizationId } from '../utils/helper';
import { buildServiceHeaders } from '../utils/request.utils';
import { BaseClient } from '@api-hub/service-clients';
import { CreatedUserInfo } from '../types/user/user.types';

export class SSOUserServiceClient extends BaseClient {
  constructor() {
    super(process.env.USER_SERVICE_BASE_URL || '', 'user-service');
  }
  async findUserByExternalId(
    params: { externalId: string },
    context: SSORequestContext,
  ): Promise<User | null> {
    const externalUserId = params.externalId;
    const subdomain = context.integration.subdomain;

    console.info('findUserByExternalId_lookup', {
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
        headers: buildServiceHeaders(context),
      });

      // User-service returns { success, data, message, error, meta }; user is in data
      type ExternalResponse = { data?: { userID?: string; emailAddress?: string; organizationID?: string; externalIdentity?: { externalUserId?: string; subdomain?: string; provider?: string }; [k: string]: unknown } };
      const body = response.data as ExternalResponse | null;
      const userPayload = body?.data ?? null;

      // User-service model uses userID; SSO expects id
      const userId = (userPayload?.userID ?? userPayload?.id) as string | undefined;
      if (!userId) {
        console.info('findUserByExternalId_service_not_found', {
          externalUserId,
          tenant: subdomain,
        });
        return null;
      }

      console.info('findUserByExternalId_success', {
        externalUserId,
        userId,
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
        console.log('findUserByExternalId error', serializeError(error as Error));
        return null;
      }

      console.log('findUserByExternalId error', serializeError(error as Error));

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
    console.log('createDoctor payload', JSON.stringify(payload));

    const response = await this.client.post<unknown>('/user', payload, {
      headers: buildServiceHeaders(context),
    });

    console.log('createDoctor response', response);
    const body:any = response?.data ?? response;
    console.log('createDoctor body', body);
    const invitedUser: string | undefined =
      body?.data?.invitedUser ??
      body?.data?.id ??
      body?.data?.userId ??
      body?.data?.userID;

    const rawUserId = invitedUser;

    if (!rawUserId) {
      console.error('createDoctor_user_id_missing', {
        subdomain: context.integration.subdomain,
        externalUserId: payload.externalIdentity?.externalUserId,
        responseBody: body,
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

    console.info('createDoctor_success', {
      externalUserId: result.externalUserId,
      userId: result.userId,
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
        console.warn('createDoctor_timeout_retry', {
          ...logBase,
          retryAttempt: 1,
        });
        return this.createDoctor(payload, context);
      }

      if (
        axios.isAxiosError(err) &&
        err.response?.status === 409 &&
        externalUserId
      ) {
        console.info('createDoctor_conflict_fetching_existing', {
          ...logBase,
          retryAttempt: 0,
        });

        const existingUser = await this.findUserByExternalId(
          { externalId: externalUserId },
          context,
        );

        if (existingUser) {
          console.info('createDoctor_conflict_resolved_existing', {
            ...logBase,
            doctorUserId: existingUser.id,
          });
          const organizationId = getOrganizationId(subdomain);
          return {
            userId: String(existingUser.id),
            email:
              existingUser.email ??
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

    console.log('createPatient payload', JSON.stringify(payload));

    const response = await this.client.post<{ data: User }>('/user', payload, {
      headers: buildServiceHeaders(context),
    });

    const user = response.data.data;
    console.log('createPatient user', user);

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
        { headers: buildServiceHeaders(context) },
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
}

export function getSSOUserServiceClient(): SSOUserServiceClient {
  return new SSOUserServiceClient();
}
