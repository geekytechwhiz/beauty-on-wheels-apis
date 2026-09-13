import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import { ServiceAreaDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export class ServiceAreasRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createServiceArea(item: ServiceAreaDdbItem): Promise<void> {
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

  async getServiceArea(
    vendorId: string,
    serviceAreaId: string,
  ): Promise<ServiceAreaDdbItem | null> {
    return this.get<ServiceAreaDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.serviceAreaSk(serviceAreaId),
    });
  }

  async listServiceAreas(vendorId: string): Promise<ServiceAreaDdbItem[]> {
    const queryParams: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':skPrefix': VendorKeyBuilder.serviceAreaSkPrefix(),
      },
    };

    return this.query<ServiceAreaDdbItem>(queryParams);
  }

  async updateServiceArea(item: ServiceAreaDdbItem): Promise<void> {
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

  async deleteServiceArea(vendorId: string, serviceAreaId: string): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.vendorPk(vendorId),
              SK: VendorKeyBuilder.serviceAreaSk(serviceAreaId),
            },
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }
}

let repository: ServiceAreasRepository;

export function getServiceAreasRepository() {
  if (!repository) {
    repository = new ServiceAreasRepository();
  }

  return repository;
}
