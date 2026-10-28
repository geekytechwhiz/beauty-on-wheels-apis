import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { isConditionalWriteFailure } from '../domain/catalog-version';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import {
  OfferingEntity,
  OfferingLookupEntity,
} from '../utils/types/catalog-domain.types';
import { vendorCatalogQuery } from './vendor-index-query';

const TABLE = () => env.DYNAMODB_TABLE_NAME;
const GSI1_INDEX = 'GSI1';

export class CatalogOfferingsRepository extends BaseRepository {
  public getTableName() {
    return TABLE();
  }

  async findById(
    offeringId: string,
    consistent = false,
  ): Promise<OfferingEntity | null> {
    return this.get<OfferingEntity>(
      TABLE(),
      {
        PK: CatalogKeyBuilder.offeringPk(offeringId),
        SK: CatalogKeyBuilder.offeringSk(),
      },
      { consistent },
    );
  }

  async listByVendor(
    vendorId: string,
    params?: {
      status?: string;
      activeOnly?: boolean;
      limit?: number;
      lastEvaluatedKey?: Record<string, unknown>;
    },
  ): Promise<{ items: OfferingEntity[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const extraFilters: string[] = [];
    const extraNames: Record<string, string> = {};
    const extraValues: Record<string, unknown> = {};
    if (params?.status) {
      extraNames['#status'] = 'status';
      extraValues[':status'] = params.status;
      extraFilters.push('#status = :status');
    }
    return this.queryPage<OfferingEntity>(vendorCatalogQuery({
      tableName: TABLE(),
      vendorId,
      sortKeyPrefix: CatalogKeyBuilder.vendorOfferingPrefix(),
      entityType: 'OFFERING',
      activeOnly: params?.activeOnly,
      extraFilters,
      extraNames,
      extraValues,
      limit: params?.limit,
      lastEvaluatedKey: params?.lastEvaluatedKey,
    }));
  }

  async findByName(name: string, vendorId: string): Promise<OfferingEntity | null> {
    return this.queryOne<OfferingEntity>({
      TableName: TABLE(),
      IndexName: GSI1_INDEX,
      KeyConditionExpression: '#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk',
      ExpressionAttributeNames: {
        '#gsi1pk': 'GSI1PK',
        '#gsi1sk': 'GSI1SK',
      },
      ExpressionAttributeValues: {
        ':gsi1pk': CatalogKeyBuilder.gsi1pk(name),
        ':gsi1sk': CatalogKeyBuilder.gsi1VendorSk('OFFERING', vendorId),
      },
    });
  }

  async createOffering(entity: OfferingEntity): Promise<void> {
    const lookup = buildLookup(entity);
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: TABLE(),
              Item: entity as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: TABLE(),
              Item: lookup as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError || isConditionalWriteFailure(error)) {
        throw error instanceof ConditionalWriteConflictError
          ? error
          : new ConditionalWriteConflictError(error);
      }
      throw error;
    }
  }

  async updateOffering(
    entity: OfferingEntity,
    expectedVersion: number,
  ): Promise<void> {
    const lookup = buildLookup(entity);
    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: TABLE(),
              Item: entity as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_exists(PK) AND #version = :expectedVersion',
              ExpressionAttributeNames: { '#version': 'version' },
              ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
            },
          },
          {
            Put: {
              TableName: TABLE(),
              Item: lookup as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError || isConditionalWriteFailure(error)) {
        throw error instanceof ConditionalWriteConflictError
          ? error
          : new ConditionalWriteConflictError(error);
      }
      throw error;
    }
  }

  async archiveOffering(
    entity: OfferingEntity,
    expectedVersion: number,
  ): Promise<void> {
    await this.updateOffering(entity, expectedVersion);
  }
}

function buildLookup(entity: OfferingEntity): OfferingLookupEntity {
  return {
    PK: CatalogKeyBuilder.offeringLookupPk(entity.offeringId),
    SK: CatalogKeyBuilder.offeringLookupSk(),
    entityType: 'OFFERING_LOOKUP',
    offeringId: entity.offeringId,
    vendorId: entity.vendorId,
    categoryId: entity.categoryId,
    offeringType: entity.offeringType,
    status: entity.status,
    active: entity.active,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

let repository: CatalogOfferingsRepository | undefined;

export function getCatalogOfferingsRepository(): CatalogOfferingsRepository {
  if (!repository) {
    repository = new CatalogOfferingsRepository();
  }
  return repository;
}
