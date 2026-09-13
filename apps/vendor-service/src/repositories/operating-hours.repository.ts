import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { VendorOperatingHoursDdbItem } from '../types/repository.types';
import { VendorKeyBuilder } from '../utils/constants/vendor-key-builder';

export class OperatingHoursRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getOperatingHours(
    vendorId: string,
  ): Promise<VendorOperatingHoursDdbItem | null> {
    return this.get<VendorOperatingHoursDdbItem>(this.getTableName(), {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.operatingHoursSk(),
    });
  }

  async putOperatingHours(item: VendorOperatingHoursDdbItem): Promise<void> {
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

let repository: OperatingHoursRepository;

export function getOperatingHoursRepository() {
  if (!repository) {
    repository = new OperatingHoursRepository();
  }

  return repository;
}
