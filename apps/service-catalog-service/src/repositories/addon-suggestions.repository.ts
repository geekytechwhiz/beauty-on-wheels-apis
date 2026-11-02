import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import {
  AddonSuggestionEntity,
  AddonSuggestionIdempotencyEntity,
  AddonSuggestionLookupEntity,
  AddonSuggestionReviewIdempotencyEntity,
  AddonSuggestionStatus,
  addonSuggestionKeys,
} from '../domain/addon-suggestion';

export class AddonSuggestionsRepository extends BaseRepository {
  getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getByVendor(vendorId: string, suggestionId: string): Promise<AddonSuggestionEntity | null> {
    return this.get<AddonSuggestionEntity>(this.getTableName(), {
      PK: addonSuggestionKeys.pk(vendorId),
      SK: addonSuggestionKeys.sk(suggestionId),
    }, { consistent: true });
  }

  async getBySuggestionId(suggestionId: string): Promise<AddonSuggestionEntity | null> {
    const lookup = await this.get<AddonSuggestionLookupEntity>(this.getTableName(), {
      PK: addonSuggestionKeys.lookupPk(suggestionId),
      SK: addonSuggestionKeys.lookupSk(),
    }, { consistent: true });
    if (!lookup?.vendorId) {
      return null;
    }
    return this.getByVendor(lookup.vendorId, suggestionId);
  }

  async getCreateIdempotency(
    vendorId: string,
    key: string,
  ): Promise<AddonSuggestionIdempotencyEntity | null> {
    return this.get<AddonSuggestionIdempotencyEntity>(this.getTableName(), {
      PK: addonSuggestionKeys.pk(vendorId),
      SK: addonSuggestionKeys.createIdempotencySk(key),
    }, { consistent: true });
  }

  async getReviewIdempotency(key: string): Promise<AddonSuggestionReviewIdempotencyEntity | null> {
    return this.get<AddonSuggestionReviewIdempotencyEntity>(this.getTableName(), {
      PK: addonSuggestionKeys.gsi1Pk(),
      SK: addonSuggestionKeys.reviewIdempotencySk(key),
    }, { consistent: true });
  }

  async listByVendor(vendorId: string): Promise<AddonSuggestionEntity[]> {
    return this.queryAll<AddonSuggestionEntity>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': addonSuggestionKeys.pk(vendorId),
        ':prefix': addonSuggestionKeys.skPrefix(),
      },
      ScanIndexForward: false,
    });
  }

  async listByStatus(status: AddonSuggestionStatus, limit: number): Promise<AddonSuggestionEntity[]> {
    const page = await this.queryPage<AddonSuggestionEntity>({
      TableName: this.getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': addonSuggestionKeys.gsi1Pk(),
        ':prefix': `STATUS#${status}#`,
      },
      ScanIndexForward: false,
      Limit: limit,
    });
    return page.items;
  }

  async createSuggestion(input: {
    suggestion: AddonSuggestionEntity;
    lookup: AddonSuggestionLookupEntity;
    idempotency?: AddonSuggestionIdempotencyEntity;
  }): Promise<void> {
    const transactItems: Array<Record<string, unknown>> = [];
    if (input.idempotency) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: input.idempotency,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      });
    }
    transactItems.push(
      {
        Put: {
          TableName: this.getTableName(),
          Item: input.suggestion,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Put: {
          TableName: this.getTableName(),
          Item: input.lookup,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
    );
    await this.transactWrite({ TransactItems: transactItems });
  }

  async updateSuggestion(
    item: AddonSuggestionEntity,
    expectedVersion: number,
    idempotency?: AddonSuggestionReviewIdempotencyEntity,
  ): Promise<void> {
    const transactItems: Array<Record<string, unknown>> = [];
    if (idempotency) {
      transactItems.push({
        Put: {
          TableName: this.getTableName(),
          Item: idempotency,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      });
    }
    transactItems.push({
      Put: {
        TableName: this.getTableName(),
        Item: item,
        ConditionExpression: 'attribute_exists(PK) AND version = :expectedVersion',
        ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
      },
    });
    await this.transactWrite({ TransactItems: transactItems });
  }
}

let repository: AddonSuggestionsRepository;

export function getAddonSuggestionsRepository() {
  if (!repository) {
    repository = new AddonSuggestionsRepository();
  }
  return repository;
}
