import { BaseRepository } from '@api-hub/utils';
import { env } from '../configs/env.config';

export type CommunityScheduleItem = { PK: string; SK: string; vendorId: string; communityId: string; timezone: string; scheduleType: 'RECURRING'; weeklySchedule: unknown[]; entityType: 'VendorCommunitySchedule'; createdAt: string; updatedAt: string };
export class CommunitySchedulesRepository extends BaseRepository {
  async getSchedule(vendorId: string, communityId: string) {
    return super.get<CommunityScheduleItem>(env.DYNAMODB_TABLE_NAME, {
      PK: `VENDOR#${vendorId}`,
      SK: `COMMUNITY_SCHEDULE#${communityId}`,
    });
  }

  async putSchedule(item: CommunityScheduleItem): Promise<void> {
    await super.put(env.DYNAMODB_TABLE_NAME, item);
  }
}
let repository: CommunitySchedulesRepository;
export function getCommunitySchedulesRepository() { if (!repository) repository = new CommunitySchedulesRepository(); return repository; }
