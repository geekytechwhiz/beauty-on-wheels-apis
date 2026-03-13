
import axios from "axios";
import { SSORequestContext } from "../types/common/context.types";
import { SSOError } from "../types/errors/sso-error";
import {
  AssignDoctorPayload,
  DoctorCreationPayload,
  PatientCreationPayload,
} from "../types/user-creation.type";
import { User } from "../types/user/user.types";
import {
  getCachedUserId,
  getOrganizationId,
  setCachedUserId,
} from "../utils/helper";
import { buildServiceHeaders } from "../utils/request.utils";
import { BaseClient } from "@api-hub/service-clients";

export class SSOUserServiceClient extends BaseClient {
  constructor() {
    super(process.env.USER_SERVICE_BASE_URL || "", "user-service");
  }
  async findUserByExternalId(
    params: { externalId: string },
    context: SSORequestContext
  ): Promise<User | null> {
    const externalUserId = params.externalId;
    const subdomain = context.integration.subdomain;
    const organizationId = getOrganizationId(subdomain);
    const cachedUserId = getCachedUserId(subdomain, externalUserId);
    const cacheHit = !!cachedUserId;

    console.info("findUserByExternalId_lookup", {
      externalUserId,
      organizationId,
      subdomain,
      cacheHit,
    });

    try {
      if (!organizationId) {
        console.warn("findUserByExternalId_organization_missing", {
          externalUserId,
          subdomain,
        });
        return null;
      }

      // 1️⃣ If cache hit, try org+userId fetch first
      if (cachedUserId) {
        const url = `/user/organization/${organizationId}/${cachedUserId}`;

        console.info("findUserByExternalId_cache_hit", {
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

          console.warn("findUserByExternalId_cache_stale", {
            externalUserId,
            organizationId,
            userId: cachedUserId,
          });
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            console.warn("findUserByExternalId_cache_hit_404", {
              externalUserId,
              organizationId,
              userId: cachedUserId,
            });
          } else {
            throw error;
          }
        }
      } else {
        console.info("findUserByExternalId_cache_miss", {
          externalUserId,
          organizationId,
        });
      }

      // 2️⃣ Fallback: query user-service by externalUserId
      // NOTE: Adjust endpoint if your user-service uses a different route.
      try {
        const response = await this.client.get<{ data: User | null }>(
          "/user/by-external-id",
          {
            params: {
              organizationId,
              externalUserId,
            },
            headers: buildServiceHeaders(context),
          }
        );

        const user = response.data?.data ?? null;

        if (!user?.id) {
          console.info("findUserByExternalId_service_not_found", {
            externalUserId,
            organizationId,
          });
          return null;
        }

        setCachedUserId(subdomain, externalUserId, String(user.id));

        console.info("findUserByExternalId_cache_update", {
          externalUserId,
          organizationId,
          userId: user.id,
        });

        return user;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          console.info("findUserByExternalId_service_404", {
            externalUserId,
            organizationId,
          });
          return null;
        }

        throw error;
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }

      console.log("findUserByExternalId error", JSON.stringify(error));

      throw SSOError.userServiceError(
        "User service doctor lookup failed",
        error as Error
      );
    }
  }

  async createDoctor(
    payload: DoctorCreationPayload,
    context: SSORequestContext
  ): Promise<User> {
    console.log("createDoctor payload", JSON.stringify(payload));

    const response = await this.client.post<{ data: User }>(
      "/user",
      payload,
      { headers: buildServiceHeaders(context) }
    );

    return response.data.data;
  }

  async createDoctorWithRetry(
    payload: DoctorCreationPayload,
    context: SSORequestContext
  ): Promise<User> {
    const subdomain = context.integration.subdomain;
    const organizationId = getOrganizationId(subdomain);
    const externalUserId = payload.externalIdentity?.externalUserId;

    const logBase = { externalUserId, organizationId, subdomain };

    try {
      const user = await this.createDoctor(payload, context);

      if (organizationId && externalUserId && user?.id) {
        setCachedUserId(subdomain, externalUserId, String(user.id));
        console.info("createDoctor_cache_update", {
          ...logBase,
          userId: user.id,
        });
      }

      return user;
    } catch (err: any) {
      if (err.code === "ECONNABORTED") {
        console.warn("createDoctor_timeout_retry", {
          ...logBase,
          retryAttempt: 1,
        });

        const user = await this.createDoctor(payload, context);

        if (organizationId && externalUserId && user?.id) {
          setCachedUserId(subdomain, externalUserId, String(user.id));
          console.info("createDoctor_cache_update", {
            ...logBase,
            userId: user.id,
          });
        }

        return user;
      }

      if (axios.isAxiosError(err) && err.response?.status === 409 && externalUserId) {
        console.info("createDoctor_conflict_fetching_existing", {
          ...logBase,
          retryAttempt: 0,
        });

        const existingUser = await this.findUserByExternalId(
          { externalId: externalUserId },
          context
        );

        if (existingUser) {
          console.info("createDoctor_conflict_resolved_existing", {
            ...logBase,
            doctorUserId: existingUser.id,
          });
          return existingUser;
        }

        console.warn("createDoctor_conflict_no_existing_user_found", {
          ...logBase,
        });
      }

      throw err;
    }
  }

  async createPatient(
    payload: PatientCreationPayload,
    context: SSORequestContext
  ): Promise<User> {
    const subdomain = context.integration.subdomain;
    const organizationId = getOrganizationId(subdomain);
    const externalUserId = payload.externalIdentity?.externalUserId;

    const logBase = { externalUserId, organizationId, subdomain };

    console.log("createPatient payload", JSON.stringify(payload));

    const response = await this.client.post<{ data: User }>(
      "/user",
      payload,
      { headers: buildServiceHeaders(context) }
    );

    const user = response.data.data;

    if (organizationId && externalUserId && user?.id) {
      setCachedUserId(subdomain, externalUserId, String(user.id));
      console.info("createPatient_cache_update", {
        ...logBase,
        userId: user.id,
      });
    }

    return user;
  }

  /**
   * Assigns a patient (receiver) to a doctor (sender) in an organization.
   * Wraps the `/user/assign-doctor` endpoint with SSO error handling.
   */
  async assignDoctor(
    payload: AssignDoctorPayload,
    context: SSORequestContext
  ): Promise<{ message: string }> {
    try {
      const response = await this.client.post<{ message: string }>(
        "/user/assign-doctor",
        payload,
        { headers: buildServiceHeaders(context) }
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const messageFromServer =
          (error.response?.data as any)?.message ||
          (status === 400
            ? "Assign doctor request is invalid"
            : status === 404
            ? "Doctor or patient not found"
            : "Assign doctor request to user service failed");

        throw SSOError.userServiceError(messageFromServer, error);
      }

      throw SSOError.userServiceError(
        "Assign doctor request to user service failed",
        error as Error
      );
    }
  }
}

export function getSSOUserServiceClient(): SSOUserServiceClient {
  return new SSOUserServiceClient();
}