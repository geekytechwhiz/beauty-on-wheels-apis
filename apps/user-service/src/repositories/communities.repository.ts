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
  search?: string;
  cityId?: string;
  localityId?: string;
  postalCode?: string;
  limit: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export class CommunitiesRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createCommunity(record: CommunityRecord): Promise<void> {
    const communityPut = {
      Put: {
        TableName: this.getTableName(),
        Item: withoutUndefined(record),
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    };
    if (!record.code) {
      await this.transactWrite({ TransactItems: [communityPut] });
      return;
    }
    await this.transactWrite({
      TransactItems: [
        communityPut,
        {
          Put: {
            TableName: this.getTableName(),
            Item: {
              PK: UserKeyBuilder.communityCodePk(record.code),
              SK: UserKeyBuilder.communityCodeSk(),
              entityType: 'CommunityCodeClaim',
              communityId: record.communityId,
              code: record.code,
              createdAt: record.createdAt,
            },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  async getCommunity(communityId: string): Promise<CommunityRecord | null> {
    return this.get<CommunityRecord>(this.getTableName(), {
      PK: UserKeyBuilder.communityPk(communityId),
      SK: UserKeyBuilder.communitySk(),
    });
  }

  async saveCommunity(record: CommunityRecord, previousCode?: string): Promise<void> {
    const communityPut = {
      Put: {
        TableName: this.getTableName(),
        Item: withoutUndefined(record),
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
      },
    };
    if (!record.code) {
      await this.transactWrite({ TransactItems: [communityPut] });
      return;
    }

    const transactItems: TransactItems = [
      communityPut,
      {
        Put: {
          TableName: this.getTableName(),
          Item: {
            PK: UserKeyBuilder.communityCodePk(record.code),
            SK: UserKeyBuilder.communityCodeSk(),
            entityType: 'CommunityCodeClaim',
            communityId: record.communityId,
            code: record.code,
            createdAt: record.createdAt,
          },
          // Enables a legacy record to gain its first claim, and permits a retry by its owner.
          ConditionExpression: 'attribute_not_exists(PK) OR communityId = :communityId',
          ExpressionAttributeValues: { ':communityId': record.communityId },
        },
      },
    ];
    if (previousCode && previousCode !== record.code) {
      transactItems.push({
        Delete: {
          TableName: this.getTableName(),
          Key: {
            PK: UserKeyBuilder.communityCodePk(previousCode),
            SK: UserKeyBuilder.communityCodeSk(),
          },
          ConditionExpression: 'attribute_not_exists(PK) OR communityId = :communityId',
          ExpressionAttributeValues: { ':communityId': record.communityId },
        },
      });
    }
    await this.transactWrite({ TransactItems: transactItems });
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

    const filters: string[] = [];
    const names: Record<string, string> = {};
    if (query.status) {
      names['#status'] = 'status';
      params.ExpressionAttributeValues = { ...params.ExpressionAttributeValues, ':status': query.status };
      filters.push('#status = :status');
    }
    if (query.cityId) {
      names['#cityId'] = 'cityId';
      params.ExpressionAttributeValues = { ...params.ExpressionAttributeValues, ':cityId': query.cityId };
      filters.push('#cityId = :cityId');
    }
    if (query.localityId) {
      names['#localityId'] = 'localityId';
      params.ExpressionAttributeValues = { ...params.ExpressionAttributeValues, ':localityId': query.localityId };
      filters.push('#localityId = :localityId');
    }
    if (query.postalCode) {
      names['#postalCode'] = 'postalCode';
      params.ExpressionAttributeValues = { ...params.ExpressionAttributeValues, ':postalCode': query.postalCode };
      filters.push('#postalCode = :postalCode');
    }
    if (query.search) {
      const search = query.search.trim().toLowerCase();
      names['#searchText'] = 'searchText';
      params.ExpressionAttributeValues = { ...params.ExpressionAttributeValues, ':search': search };
      filters.push('contains(#searchText, :search)');
    }
    if (filters.length) {
      params.FilterExpression = filters.join(' AND ');
      params.ExpressionAttributeNames = names;
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
