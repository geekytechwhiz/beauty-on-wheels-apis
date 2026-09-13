import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { VendorBranchDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export class BranchesRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createBranch(item: VendorBranchDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.vendorPk(item.vendorId),
              SK: VendorKeyBuilder.vendorSk(),
            },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  async getBranch(
    vendorId: string,
    branchId: string,
  ): Promise<VendorBranchDdbItem | null> {
    return this.get<VendorBranchDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.branchSk(branchId),
    });
  }

  async listBranches(vendorId: string): Promise<VendorBranchDdbItem[]> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':skPrefix': VendorKeyBuilder.branchSkPrefix(),
      },
    };

    return this.query<VendorBranchDdbItem>(queryParams);
  }

  async updateBranch(item: VendorBranchDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }

  async deleteBranch(vendorId: string, branchId: string): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.vendorPk(vendorId),
              SK: VendorKeyBuilder.branchSk(branchId),
            },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }
}

let repository: BranchesRepository;

export function getBranchesRepository() {
  if (!repository) {
    repository = new BranchesRepository();
  }

  return repository;
}
