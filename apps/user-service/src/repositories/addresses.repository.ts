import { BaseRepository } from '@api-hub/utils';
import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { AddressRecord, AddressWrite } from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

type TransactItems = NonNullable<TransactWriteCommandInput['TransactItems']>;

export class AddressesRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async listByUser(userId: string): Promise<AddressRecord[]> {
    return this.queryAll<AddressRecord>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': UserKeyBuilder.userPk(userId),
        ':sk': UserKeyBuilder.addressSkPrefix(),
      },
    });
  }

  async getAddress(
    userId: string,
    addressId: string,
  ): Promise<AddressRecord | null> {
    return this.get<AddressRecord>(this.getTableName(), {
      PK: UserKeyBuilder.userPk(userId),
      SK: UserKeyBuilder.addressSk(addressId),
    });
  }

  async writeAddress(change: AddressWrite): Promise<void> {
    const transactItems: TransactItems = [
      {
        Put: {
          TableName: this.getTableName(),
          Item: withoutUndefined(change.address),
          ...(change.expectExisting
            ? {
                ConditionExpression:
                  'attribute_exists(PK) AND attribute_exists(SK)',
              }
            : {}),
        },
      },
    ];

    if (change.clearAddress) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: withoutUndefined(change.clearAddress),
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
        },
      });
    }

    if (change.promoteAddress) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: withoutUndefined(change.promoteAddress),
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
        },
      });
    }

    if (change.profileUpdate) {
      const update = change.profileUpdate;
      transactItems.push({
        Update: {
          TableName: this.getTableName(),
          Key: {
            PK: UserKeyBuilder.userPk(update.userId),
            SK: UserKeyBuilder.profileSk(),
          },
          UpdateExpression:
            update.defaultAddressId === null
              ? 'REMOVE defaultAddressId SET updatedAt = :updatedAt'
              : 'SET defaultAddressId = :defaultAddressId, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          ExpressionAttributeValues:
            update.defaultAddressId === null
              ? { ':updatedAt': update.updatedAt }
              : {
                  ':defaultAddressId': update.defaultAddressId,
                  ':updatedAt': update.updatedAt,
                },
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });
  }
}

let repository: AddressesRepository;

export function getAddressesRepository(): AddressesRepository {
  if (!repository) {
    repository = new AddressesRepository();
  }
  return repository;
}
