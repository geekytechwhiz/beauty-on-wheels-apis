 
import { BaseClient } from "@api-hub/service-clients";
import axios from "axios";
import { SSORequestContext } from "../types/common/context.types";
import { SSOError } from "../types/errors/sso-error";
import {
  AssignDoctorPayload,
  DoctorCreationPayload,
  PatientCreationPayload,
} from "../types/user-creation.type";
import { User } from "../types/user/user.types";
import { getCachedUserId, getOrganizationId } from "../utils/helper";
import { buildServiceHeaders } from "../utils/request.utils";

export class SSOUserServiceClient extends BaseClient {
  constructor() {
    super(process.env.USER_SERVICE_BASE_URL || "", "user-service");
  }
  async findUserByExternalId(
    params: { externalId: string },
    context: SSORequestContext
  ): Promise<User | null> {
  
    try {
  
      console.log("findUserByExternalId context", JSON.stringify(context));
  
      const organizationId = getOrganizationId(context.integration.subdomain);
      const userId = getCachedUserId(
        context.integration.subdomain,
        params.externalId
      );
  
      console.log("findUserByExternalId orgId", organizationId);
      console.log("findUserByExternalId userId", userId);
      console.log("findUserByExternalId params", JSON.stringify(params));
  
      /**
       * Validate organization
       */
      if (!organizationId) {
        console.warn("findUserByExternalId organizationId missing");
        return null;
      }
  
      /**
       * Cache miss → user not created yet
       */
      if (!userId) {
        console.info("findUserByExternalId cache_miss", params.externalId);
        return null;
      }
  
      /**
       * Fetch user from user service
       */
      const url = `/user/organization/${organizationId}/${userId}`;
  
      console.log("findUserByExternalId URL", url);
  
      const response = await this.client<User>(
        url,
        { headers: buildServiceHeaders(context) }
      );
  
      return response?.data ?? null;
  
    } catch (error) {
  
      /**
       * User not found in user-service
       */
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
      '/user',
      payload,
      { headers: buildServiceHeaders(context) }
    );

    return response.data.data;
  }
  async createDoctorWithRetry(payload: DoctorCreationPayload, context: SSORequestContext): Promise<User> {
    try {
      return await this.createDoctor(payload, context)
    } catch (err: any) {
      if (err.code === 'ECONNABORTED') {
        return await this.createDoctor(payload, context)
      }
      if (err.response?.status === 409) {
          console.info("Doctor already exists, fetching existing user");
        
        const existingUser = await this.findUserByExternalId({ externalId: payload.externalIdentity.externalUserId }, context);
        if (existingUser) {
          return existingUser;
        }

      }
    
      throw err
    }
  }
  async createPatient(
    payload: PatientCreationPayload,
    context: SSORequestContext
  ): Promise<User> {

    const response = await this.client.post<{ data: User }>(
      '/user',
      payload,
      { headers: buildServiceHeaders(context) }
    );

    return response.data.data;
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