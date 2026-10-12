import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { AvailabilityKeyBuilder } from '../domain/keys';
import { ScheduleIndexItem, WorkingHoursItem } from '../types/records';

export class AvailabilityRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getWorkingHours(
    vendorId: string,
    branchId: string,
  ): Promise<WorkingHoursItem | null> {
    return this.get<WorkingHoursItem>(this.getTableName(), {
      PK: AvailabilityKeyBuilder.schedulePk(vendorId, branchId),
      SK: AvailabilityKeyBuilder.scheduleSk(),
    });
  }

  async listWorkingHours(vendorId: string): Promise<ScheduleIndexItem[]> {
    return this.queryAll<ScheduleIndexItem>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': AvailabilityKeyBuilder.scheduleIndexPk(vendorId),
        ':prefix': 'BRANCH#',
      },
    });
  }

  async saveWorkingHours(
    hours: WorkingHoursItem,
    index: ScheduleIndexItem,
  ): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: hours,
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: index,
            ConditionExpression: 'attribute_not_exists(PK) OR branchId = :branchId',
            ExpressionAttributeValues: {
              ':branchId': index.branchId,
            },
          },
        },
      ],
    });
  }
}

let repository: AvailabilityRepository;

export function getAvailabilityRepository(): AvailabilityRepository {
  if (!repository) {
    repository = new AvailabilityRepository();
  }
  return repository;
}
