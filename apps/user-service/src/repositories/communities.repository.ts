import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { CommunityStatus } from '../domain/constants';
import {
  CommunityMembershipRecord,
  CommunityRecord,
  MembershipReplacement,
} from '../types/records';
import { GSI1_INDEX, UserKeyBuilder, withoutUndefined } from '../utils';

type TransactItems = NonNullable<TransactWriteCommandInput['TransactItems']>;

export interface CommunityListQuery {
  status?: CommunityStatus;
  limit: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export class CommunitiesRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createCommunity(record: CommunityRecord): Promise<void> {
    await this.put(
      this.getTableName(),
      withoutUndefined(record),
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
  }

  async getCommunity(communityId: string): Promise<CommunityRecord | null> {
    return this.get<CommunityRecord>(this.getTableName(), {
      PK: UserKeyBuilder.communityPk(communityId),
      SK: UserKeyBuilder.communitySk(),
    });
  }

  async saveCommunity(record: CommunityRecord): Promise<void> {
    await this.put(
      this.getTableName(),
      withoutUndefined(record),
      'attribute_exists(PK) AND attribute_exists(SK)',
    );
  }

  async listCommunities(query: CommunityListQuery): Promise<{
    items: CommunityRecord[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': UserKeyBuilder.communityListPk(),
      },
      Limit: query.limit,
      ExclusiveStartKey: query.lastEvaluatedKey,
      ScanIndexForward: false,
    };

    if (query.status) {
      params.FilterExpression = '#status = :status';
      params.ExpressionAttributeNames = { '#status': 'status' };
      params.ExpressionAttributeValues = {
        ...params.ExpressionAttributeValues,
        ':status': query.status,
      };
    }

    return this.queryPage<CommunityRecord>(params);
  }

  async listMemberships(userId: string): Promise<CommunityMembershipRecord[]> {
    return this.queryAll<CommunityMembershipRecord>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': UserKeyBuilder.userPk(userId),
        ':sk': UserKeyBuilder.membershipSkPrefix(),
      },
    });
  }

  async replaceMemberships(change: MembershipReplacement): Promise<void> {
    const transactItems: TransactItems = [
      {
        Update: {
          TableName: this.getTableName(),
          Key: {
            PK: UserKeyBuilder.userPk(change.userId),
            SK: UserKeyBuilder.profileSk(),
          },
          UpdateExpression:
            'SET communityIds = :communityIds, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          ExpressionAttributeValues: {
            ':communityIds': change.communityIds,
            ':updatedAt': change.updatedAt,
          },
        },
      },
    ];

    for (const membership of change.toPut) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: membership,
        },
      });
    }

    for (const communityId of change.toDelete) {
      transactItems.push({
        Delete: {
          TableName: this.getTableName(),
          Key: {
            PK: UserKeyBuilder.userPk(change.userId),
            SK: UserKeyBuilder.membershipSk(communityId),
          },
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });
  }
}

let repository: CommunitiesRepository;

export function getCommunitiesRepository(): CommunitiesRepository {
  if (!repository) {
    repository = new CommunitiesRepository();
  }
  return repository;
}
