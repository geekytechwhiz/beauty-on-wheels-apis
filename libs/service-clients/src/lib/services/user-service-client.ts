import { BaseClient } from "../client/base-service-client";
import {
  UserDTO,
  BatchUsersResponse,
  OrganizationUsersResponse,
} from "../types/dto";

export class UserServiceClient extends BaseClient {
  constructor() {
    const baseUrl = (process.env.USER_SERVICE_URL || "").replace(/\/$/, "");
    super(baseUrl, "user-service");
  }

  async getUser(userId: string, authHeader?: string): Promise<UserDTO | null> {
    return this.get<UserDTO>(`/users/${userId}`, authHeader);
  }

  async getUserByEmail(
    email: string,
    authHeader?: string
  ): Promise<UserDTO | null> {
    return this.get<UserDTO>(`/users/by-email/${email}`, authHeader);
  }

  async listUsersByOrganization(
    organizationId: string,
    authHeader?: string
  ): Promise<UserDTO[] | null> {
    const response = await this.get<OrganizationUsersResponse>(
      `/users/by-organization/${organizationId}`,
      authHeader
    );

    return response?.users ?? null;
  }

  async validateUserExists(
    userId: string,
    authHeader?: string
  ): Promise<boolean> {
    const user = await this.getUser(userId, authHeader);
    return user !== null;
  }

  async batchGetUsers(
    userIds: string[],
    authHeader?: string
  ): Promise<UserDTO[]> {
    const response = await this.post<BatchUsersResponse>(
      "/users/batch",
      { userIds },
      authHeader
    );

    return response?.users ?? [];
  }
}

