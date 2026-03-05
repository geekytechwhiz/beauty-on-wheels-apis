import { BaseClient } from "../client/base-service-client";
import {
  RelationshipDTO,
  RelationshipsResponse,
  EmergencyContactsResponse,
  RelationshipCreatedResponse,
} from "../types/dto";

export class RelationshipServiceClient extends BaseClient {
  constructor() {
    const baseUrl = (process.env.RELATIONSHIP_SERVICE_URL || "").replace(
      /\/$/,
      ""
    );
    super(baseUrl, "relationship-service");
  }

  async getRelationships(
    userId: string,
    authHeader?: string
  ): Promise<RelationshipsResponse | null> {
    return this.get<RelationshipsResponse>(
      `/relationships/user/${userId}`,
      authHeader
    );
  }

  async createRelationship(
    input: {
      userId: string;
      memberId: string;
      userName: string;
      memberName: string;
      relationType: string;
      emergencyContact: boolean;
      organizationId: string;
    },
    authHeader?: string
  ): Promise<boolean> {
    const response = await this.post<RelationshipCreatedResponse>(
      "/relationships",
      input,
      authHeader
    );

    return response?.success ?? false;
  }

  async getEmergencyContacts(
    userId: string,
    authHeader?: string
  ): Promise<RelationshipDTO[] | null> {
    const response = await this.get<EmergencyContactsResponse>(
      `/relationships/user/${userId}/emergency-contacts`,
      authHeader
    );

    return response?.contacts ?? null;
  }
}

