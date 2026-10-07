import { ENTITY_TYPE } from '../domain/constants';
import { OperationalPreferences } from '../types/api-types';
import { OperationalPreferencesRecord } from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

export function toOperationalPreferences(
  record: OperationalPreferencesRecord | undefined,
  userId: string,
): OperationalPreferences {
  if (!record) {
    return {
      userId,
      whatsapp: true,
      sms: true,
      email: true,
      push: true,
    };
  }

  return {
    userId: record.userId,
    whatsapp: record.whatsapp,
    sms: record.sms,
    email: record.email,
    push: record.push,
    ...(record.language ? { language: record.language } : {}),
    ...(record.timezone ? { timezone: record.timezone } : {}),
    updatedAt: record.updatedAt,
  };
}

export function toPreferencesRecord(input: {
  userId: string;
  whatsapp: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  language?: string;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}): OperationalPreferencesRecord {
  return withoutUndefined({
    PK: UserKeyBuilder.userPk(input.userId),
    SK: UserKeyBuilder.preferencesSk(),
    entityType: ENTITY_TYPE.OPERATIONAL_PREFERENCES,
    userId: input.userId,
    whatsapp: input.whatsapp,
    sms: input.sms,
    email: input.email,
    push: input.push,
    language: input.language,
    timezone: input.timezone,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}
