import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { VendorCapabilitiesDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export class CapabilitiesRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getCapabilities(
    vendorId: string,
  ): Promise<VendorCapabilitiesDdbItem | null> {
    return this.get<VendorCapabilitiesDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.capabilitiesSk(),
    });
  }

  async putCapabilities(item: VendorCapabilitiesDdbItem): Promise<void> {
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
          },
        },
      ],
    });
  }
}

let repository: CapabilitiesRepository;

export function getCapabilitiesRepository() {
  if (!repository) {
    repository = new CapabilitiesRepository();
  }

  return repository;
}
