import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { OperationalPreferencesRecord } from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

export class PreferencesRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getPreferences(
    userId: string,
  ): Promise<OperationalPreferencesRecord | null> {
    return this.get<OperationalPreferencesRecord>(this.getTableName(), {
      PK: UserKeyBuilder.userPk(userId),
      SK: UserKeyBuilder.preferencesSk(),
    });
  }

  async savePreferences(record: OperationalPreferencesRecord): Promise<void> {
    await this.put(this.getTableName(), withoutUndefined(record));
  }
}

let repository: PreferencesRepository;

export function getPreferencesRepository(): PreferencesRepository {
  if (!repository) {
    repository = new PreferencesRepository();
  }
  return repository;
}
