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
import {
  getCachedUserId,
  getOrganizationId,
  setCachedUserId,
} from '../utils/helper';
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
    console.log('findUserByExternalId context', context);
    const externalUserId = params.externalId;
    const subdomain = context.integration.subdomain;
    const organizationId = getOrganizationId(subdomain);
    const cachedUserId = getCachedUserId(subdomain, externalUserId);
    const cacheHit = !!cachedUserId;

    console.info('findUserByExternalId_lookup', {
      externalUserId,
      organizationId,
      subdomain,
      cacheHit,
    });

    try {
      if (!organizationId) {
        console.warn('findUserByExternalId_organization_missing', {
          externalUserId,
          subdomain,
        });
      }

      // 1️⃣ If cache hit and we have an organization, try org+userId fetch first
      if (organizationId && cachedUserId) {
        const url = `/user/organization/${organizationId}/${cachedUserId}`;

        console.info('findUserByExternalId_cache_hit', {
          externalUserId,
          organizationId,
          userId: cachedUserId,
        });

        try {
          const response = await this.client<User>(url, {
            headers: buildServiceHeaders(context),
          });

          const user = response?.data ?? null;

          if (user?.id) {
            return user;
          }

          console.warn('findUserByExternalId_cache_stale', {
            externalUserId,
            organizationId,
            userId: cachedUserId,
          });
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            console.warn('findUserByExternalId_cache_hit_404', {
              externalUserId,
              organizationId,
              userId: cachedUserId,
            });
          } else {
            throw error;
          }
        }
      } else {
        console.info('findUserByExternalId_cache_miss', {
          externalUserId,
          organizationId,
        });
      }

      // 2️⃣ Fallback: query user-service by external identity mapping
      try {
        const provider = (context.integration.providerId || 'hms')
          .toString()
          .toLowerCase();
        console.log('findUserByExternalId provider', provider);
        console.log('findUserByExternalId context.integration.providerId', context.integration.providerId);
        const response = await this.client.get<User>('/users/external', {
          params: {
            tenant: subdomain,
            provider: context.integration.providerId ,
            externalUserId,
          },
          headers: buildServiceHeaders(context),
        });

        const user = response.data ?? null;

        if (!user?.id) {
          console.info('findUserByExternalId_service_not_found', {
            externalUserId,
            tenant: subdomain,
            provider,
          });
          return null;
        }

        setCachedUserId(subdomain, externalUserId, String(user.id));

        console.info('findUserByExternalId_cache_update', {
          externalUserId,
          organizationId,
          userId: user.id,
        });

        return user;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          console.info('findUserByExternalId_service_404', {
            externalUserId,
            tenant: subdomain,
          });
          return null;
        }

        throw error;
      }
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
      organizationId: payload.organizationID 
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
    const organizationId = getOrganizationId(subdomain);
    const externalUserId = payload.externalIdentity?.externalUserId;

    const logBase = { externalUserId, organizationId, subdomain };

    try {
      const created = await this.createDoctor(payload, context);

      if (organizationId && externalUserId && created.userId) {
        setCachedUserId(subdomain, externalUserId, created.userId);
        console.info('createDoctor_cache_update', {
          ...logBase, 
          ...created,
        });
      }

      return created;
    } catch (err) {
      if ((err as any).code === 'ECONNABORTED') {
        console.warn('createDoctor_timeout_retry', {
          ...logBase,
          retryAttempt: 1,
        });

        const created = await this.createDoctor(payload, context);

        if (organizationId && externalUserId && created.userId) {
          setCachedUserId(subdomain, externalUserId, created.userId);
          console.info('createDoctor_cache_update', {
            ...logBase,
            userId: created.userId,
          });
        }

        return created;
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
          const normalized: CreatedUserInfo = {
            userId: String(existingUser.id),
            email:
              existingUser.email ??
              payload.email ??
              payload.userInfo?.contact?.email ??
              null,
            externalUserId,
            organizationId: organizationId  
          };

          if (organizationId && externalUserId && normalized.userId) {
            setCachedUserId(subdomain, externalUserId, normalized.userId);
            console.info('createDoctor_cache_update', {
              ...logBase,
              userId: normalized.userId,
            });
          }

          return normalized;
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

    const logBase = { externalUserId,  subdomain };
    const organizationId= getOrganizationId(subdomain);
    console.log('createPatient payload', JSON.stringify(payload));

    const response = await this.client.post<{ data: User }>('/user', payload, {
      headers: buildServiceHeaders(context),
    });

    const user = response.data.data;
    console.log('createPatient user', user);
    if (organizationId && externalUserId && user?.id) {
      setCachedUserId(subdomain, externalUserId, String(user.id));
      console.info('createPatient_cache_update', {
        ...logBase,
        userId: user.id,
      });
    }

    return {
      userId: String(user?.id),
      email: user.email,
      externalUserId: externalUserId,
      organizationId: organizationId
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
