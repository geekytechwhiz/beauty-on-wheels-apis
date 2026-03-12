 
import { BaseClient } from "@api-hub/service-clients";
import axios from "axios";
import { SSORequestContext } from "../types/common/context.types";
import { SSOError } from "../types/errors/sso-error";
import { DoctorCreationPayload, PatientCreationPayload } from "../types/user-creation.types";
import { User } from "../types/user/user.types";
import { buildServiceHeaders } from "../utils/request.utils";
import { getOrganizationIdBySubdomain } from "../utils/helper";
import { SERVICE_TOKEN_HEADER } from "../utils/constants";

export class SSOUserServiceClient extends BaseClient {
  constructor() {
    super(process.env.USER_SERVICE_BASE_URL || "", "user-service");
  }
  async findUserByExternalId(
    params: {
      provider: string;
      externalId: string;
      tenantId: string;
    },
    context: SSORequestContext
  ): Promise<User | null> {

    try { 
      console.log("findUserByExternalId params", JSON.stringify(params)); 
      const organizationId = getOrganizationIdBySubdomain(context.integration.subdomain);
      const userId = `${params.externalId}`;
      const serviceToken = `${SERVICE_TOKEN_HEADER ?? ''}`;
      console.log("findUserByExternalId serviceToken", serviceToken);
      console.log("findUserByExternalId organizationId", organizationId); 
      console.log("findUserByExternalId userId", userId); 
      const response = await this.client<User>(
        `/user/organization/${organizationId}/${userId}`,
        { headers: buildServiceHeaders(context) }
      );

      return response?.data ?? null;

    } catch (error) {

      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.log("findUserByExternalId error", JSON.stringify(error)); 
      throw SSOError.userServiceError(
        'User lookup failed',
        error as Error
      );
    }
  }

  async createDoctor(
    payload: DoctorCreationPayload,
    context: SSORequestContext
  ): Promise<User> {

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
}

export function getSSOUserServiceClient(): SSOUserServiceClient {
  return new SSOUserServiceClient();
}