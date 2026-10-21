import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';
import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { toPhoneLookupRecord } from '../mappers/customers.mapper';
import {
  CustomerProfileRecord,
  IdentityUserLookupRecord,
  PhoneLookupRecord,
} from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

type TransactItems = NonNullable<TransactWriteCommandInput['TransactItems']>;

export class CustomersRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getProfile(userId: string): Promise<CustomerProfileRecord | null> {
    return this.get<CustomerProfileRecord>(this.getTableName(), {
      PK: UserKeyBuilder.userPk(userId),
      SK: UserKeyBuilder.profileSk(),
    });
  }

  async getPhoneLookup(e164: string): Promise<PhoneLookupRecord | null> {
    return this.get<PhoneLookupRecord>(this.getTableName(), {
      PK: UserKeyBuilder.phonePk(e164),
      SK: UserKeyBuilder.phoneSk(),
    });
  }

  async getIdentityLookup(identityId: string): Promise<IdentityUserLookupRecord | null> {
    return this.get<IdentityUserLookupRecord>(this.getTableName(), {
      PK: UserKeyBuilder.identityPk(identityId),
      SK: UserKeyBuilder.identitySk(),
    });
  }

  /**
   * Atomically creates the minimal User Service profile and its immutable
   * identity lookup.  The lookup condition is the uniqueness constraint; it
   * protects against EventBridge duplicates and concurrent deliveries.
   */
  async createProvisionedUser(
    profile: CustomerProfileRecord,
    identityId: string,
  ): Promise<void> {
    const lookup: IdentityUserLookupRecord = {
      PK: UserKeyBuilder.identityPk(identityId),
      SK: UserKeyBuilder.identitySk(),
      entityType: 'IdentityUserLookup',
      identityId,
      userId: profile.userId,
      createdAt: profile.createdAt,
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: withoutUndefined(profile),
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: lookup,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  async saveProfile(
    profile: CustomerProfileRecord,
    options: { isCreate: boolean; previousPhone?: string },
  ): Promise<void> {
    const item = withoutUndefined(profile);
    const transactItems: TransactItems = [
      {
        Put: {
          TableName: this.getTableName(),
          Item: item,
          ConditionExpression: options.isCreate
            ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            : 'attribute_exists(PK) AND attribute_exists(SK)',
        },
      },
    ];

    const nextPhone = profile.phone;
    const previousPhone = options.previousPhone;
    const lookup = toPhoneLookupRecord(profile);

    if (lookup) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: lookup,
          ConditionExpression: 'attribute_not_exists(PK) OR userId = :userId',
          ExpressionAttributeValues: {
            ':userId': profile.userId,
          },
        },
      });
    }

    if (previousPhone && previousPhone !== nextPhone) {
      transactItems.push({
        Delete: {
          TableName: this.getTableName(),
          Key: {
            PK: UserKeyBuilder.phonePk(previousPhone),
            SK: UserKeyBuilder.phoneSk(),
          },
          ConditionExpression: 'attribute_not_exists(PK) OR userId = :userId',
          ExpressionAttributeValues: {
            ':userId': profile.userId,
          },
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });
  }
}

let repository: CustomersRepository;

export function getCustomersRepository(): CustomersRepository {
  if (!repository) {
    repository = new CustomersRepository();
  }
  return repository;
}

export function profileWriteFailure(
  error: unknown,
  isCreate: boolean,
): 'duplicate-profile' | 'missing-profile' | 'phone' | undefined {
  if (!(error instanceof ConditionalWriteConflictError)) {
    return undefined;
  }

  const failed = error.failedTransactItemIndexes ?? [];
  if (failed.includes(0) || (failed.length === 0 && isCreate)) {
    return isCreate ? 'duplicate-profile' : 'missing-profile';
  }
  return 'phone';
}
