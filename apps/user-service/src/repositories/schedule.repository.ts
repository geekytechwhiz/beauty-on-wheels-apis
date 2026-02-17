import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { ScheduleEntry, SchedulePreferences, ScheduleExclusion } from '../models/Schedule';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const USER_TABLE_NAME = process.env.USER_TABLE || '';

function schedulePk(userId: string): string {
  return `USER#${userId}`;
}

function scheduleSk(organizationId: string, scheduleId: string): string {
  return `SCHEDULE#${organizationId}#${scheduleId}`;
}

function preferenceSk(organizationId: string): string {
  return `SCHEDULE_PREFERENCE#${organizationId}`;
}

function exclusionSk(organizationId: string, scheduleId: string, date: string): string {
  return `SCHEDULE_EXCLUSION#${organizationId}#${scheduleId}#${date}`;
}

export async function getSchedulePreferences(
  userId: string,
  organizationId: string,
): Promise<SchedulePreferences | null> {
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: USER_TABLE_NAME,
        Key: {
          pk: schedulePk(userId),
          sk: preferenceSk(organizationId),
        },
      }),
    );
    if (!result.Item) return null;
    const item = result.Item as Record<string, unknown>;
    return {
      workingHours: item.workingHours as SchedulePreferences['workingHours'],
      slotDurationInMinutes: item.slotDurationInMinutes as number | undefined,
      availability: item.availability as SchedulePreferences['availability'],
      leaves: item.leaves as SchedulePreferences['leaves'],
      customAvailability: item.customAvailability as SchedulePreferences['customAvailability'],
      slotsFrequency: item.slotsFrequency as number | undefined,
      maxEventAllowedPerDay: item.maxEventAllowedPerDay as number | undefined,
    };
  } catch (err) {
    logger.error({ event: 'getSchedulePreferences_error', err: serializeError(err) });
    throw err;
  }
}

export async function putSchedulePreferences(
  userId: string,
  organizationId: string,
  prefs: SchedulePreferences,
): Promise<void> {
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  try {
    await docClient.send(
      new PutCommand({
        TableName: USER_TABLE_NAME,
        Item: {
          pk: schedulePk(userId),
          sk: preferenceSk(organizationId),
          ...prefs,
          modifiedAt: Date.now(),
        },
      }),
    );
    logger.info({ event: 'putSchedulePreferences_success' });
  } catch (err) {
    logger.error({ event: 'putSchedulePreferences_error', err: serializeError(err) });
    throw err;
  }
}

export async function getSchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
): Promise<ScheduleEntry | null> {
  const logger = createChildLogger(baseLogger, { userId, organizationId, scheduleId });
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: USER_TABLE_NAME,
        Key: {
          pk: schedulePk(userId),
          sk: scheduleSk(organizationId, scheduleId),
        },
      }),
    );
    if (!result.Item) return null;
    return mapItemToScheduleEntry(result.Item as Record<string, unknown>, organizationId, scheduleId);
  } catch (err) {
    logger.error({ event: 'getSchedule_error', err: serializeError(err) });
    throw err;
  }
}

export async function listSchedulesByDateRange(
  userId: string,
  organizationId: string,
  startDate: string,
  endDate: string,
  scheduleType?: string,
): Promise<ScheduleEntry[]> {
  const logger = createChildLogger(baseLogger, { userId, organizationId, startDate, endDate });
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression:
          'organizationId = :orgId AND #startDate <= :endDate AND #endDate >= :startDate',
        ExpressionAttributeNames: {
          '#startDate': 'startDate',
          '#endDate': 'endDate',
        },
        ExpressionAttributeValues: {
          ':pk': schedulePk(userId),
          ':skPrefix': `SCHEDULE#${organizationId}#`,
          ':orgId': organizationId,
          ':startDate': startDate,
          ':endDate': endDate,
        },
      }),
    );
    const items = (result.Items || []) as Record<string, unknown>[];
    let list = items.map((item) =>
      mapItemToScheduleEntry(item, organizationId, (item.sk as string).split('#')[2]),
    );
    if (scheduleType && scheduleType.toUpperCase() !== 'ALL') {
      list = list.filter((s) => s.scheduleType === scheduleType.toUpperCase());
    } else if (scheduleType?.toUpperCase() === 'ALL') {
      list = list.filter((s) => s.scheduleType !== 'EDIT_DATES');
    }
    logger.info({ event: 'listSchedulesByDateRange_success', count: list.length });
    return list;
  } catch (err) {
    logger.error({ event: 'listSchedulesByDateRange_error', err: serializeError(err) });
    throw err;
  }
}

export async function createSchedule(
  userId: string,
  organizationId: string,
  entry: Omit<ScheduleEntry, 'scheduleId' | 'createdAt' | 'modifiedAt'> & { scheduleId: string },
): Promise<ScheduleEntry> {
  const logger = createChildLogger(baseLogger, { userId, organizationId, scheduleId: entry.scheduleId });
  try {
    const now = Date.now();
    const item = {
      pk: schedulePk(userId),
      sk: scheduleSk(organizationId, entry.scheduleId),
      ...entry,
      organizationId,
      createdAt: now,
      modifiedAt: now,
    };
    await docClient.send(
      new PutCommand({
        TableName: USER_TABLE_NAME,
        Item: item,
      }),
    );
    logger.info({ event: 'createSchedule_success' });
    return mapItemToScheduleEntry(item as Record<string, unknown>, organizationId, entry.scheduleId);
  } catch (err) {
    logger.error({ event: 'createSchedule_error', err: serializeError(err) });
    throw err;
  }
}

export async function updateSchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
  updates: Partial<ScheduleEntry>,
): Promise<ScheduleEntry | null> {
  const existing = await getSchedule(userId, organizationId, scheduleId);
  if (!existing) return null;

  const logger = createChildLogger(baseLogger, { userId, organizationId, scheduleId });
  const now = Date.now();
  const allowedKeys = [
    'scheduleTitle', 'scheduleNote', 'startDate', 'endDate', 'frequency', 'dayOfWeek',
    'timeSlots', 'leaveType', 'isEnabled', 'queueCapacity', 'maxCapacity', 'scheduleType', 'isDeleted',
  ];
  const updateExpr: string[] = ['#modifiedAt = :modifiedAt'];
  const exprNames: Record<string, string> = { '#modifiedAt': 'modifiedAt' };
  const exprValues: Record<string, unknown> = { ':modifiedAt': now };

  for (const key of allowedKeys) {
    const v = (updates as Record<string, unknown>)[key];
    if (v === undefined) continue;
    const attr = `#${key}`;
    const val = `:${key}`;
    updateExpr.push(`${attr} = ${val}`);
    exprNames[attr] = key;
    exprValues[val] = v;
  }

  if (updateExpr.length <= 1) return existing;

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: USER_TABLE_NAME,
        Key: { pk: schedulePk(userId), sk: scheduleSk(organizationId, scheduleId) },
        UpdateExpression: `SET ${updateExpr.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
      }),
    );
    logger.info({ event: 'updateSchedule_success' });
    return getSchedule(userId, organizationId, scheduleId);
  } catch (err) {
    logger.error({ event: 'updateSchedule_error', err: serializeError(err) });
    throw err;
  }
}

export async function deleteSchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
): Promise<boolean> {
  const logger = createChildLogger(baseLogger, { userId, organizationId, scheduleId });
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: USER_TABLE_NAME,
        Key: { pk: schedulePk(userId), sk: scheduleSk(organizationId, scheduleId) },
      }),
    );
    logger.info({ event: 'deleteSchedule_success' });
    return true;
  } catch (err) {
    logger.error({ event: 'deleteSchedule_error', err: serializeError(err) });
    throw err;
  }
}

export async function listExclusions(
  userId: string,
  organizationId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleExclusion[]> {
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': schedulePk(userId),
          ':skPrefix': `SCHEDULE_EXCLUSION#${organizationId}#`,
        },
      }),
    );
    const items = (result.Items || []) as Record<string, unknown>[];
    const list = items
      .filter((item) => {
        const d = (item.date as string) || '';
        return d >= startDate && d <= endDate;
      })
      .map((item) => ({
        scheduleId: item.scheduleId as string,
        date: item.date as string,
        type: (item.type as 'exclude' | 'edited') || 'exclude',
        timeSlots: item.timeSlots as ScheduleExclusion['timeSlots'],
        maxCapacity: item.maxCapacity as number | undefined,
        queueCapacity: item.queueCapacity as number | undefined,
        organizationId: item.organizationId as string | undefined,
      }));
    logger.info({ event: 'listExclusions_success', count: list.length });
    return list;
  } catch (err) {
    logger.error({ event: 'listExclusions_error', err: serializeError(err) });
    throw err;
  }
}

export async function addExclusions(
  userId: string,
  organizationId: string,
  exclusions: Omit<ScheduleExclusion, 'organizationId'>[],
): Promise<void> {
  const logger = createChildLogger(baseLogger, { userId, organizationId });
  try {
    for (const ex of exclusions) {
      await docClient.send(
        new PutCommand({
          TableName: USER_TABLE_NAME,
          Item: {
            pk: schedulePk(userId),
            sk: exclusionSk(organizationId, ex.scheduleId, ex.date),
            scheduleId: ex.scheduleId,
            date: ex.date,
            type: ex.type,
            timeSlots: ex.timeSlots,
            maxCapacity: ex.maxCapacity,
            queueCapacity: ex.queueCapacity,
            organizationId,
          },
        }),
      );
    }
    logger.info({ event: 'addExclusions_success', count: exclusions.length });
  } catch (err) {
    logger.error({ event: 'addExclusions_error', err: serializeError(err) });
    throw err;
  }
}

export async function deleteExclusionsBySchedule(
  userId: string,
  organizationId: string,
  scheduleId: string,
): Promise<number> {
  const logger = createChildLogger(baseLogger, { userId, organizationId, scheduleId });
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': schedulePk(userId),
          ':skPrefix': `SCHEDULE_EXCLUSION#${organizationId}#${scheduleId}#`,
        },
      }),
    );
    const items = result.Items || [];
    for (const item of items) {
      await docClient.send(
        new DeleteCommand({
          TableName: USER_TABLE_NAME,
          Key: { pk: (item as Record<string, string>).pk, sk: (item as Record<string, string>).sk },
        }),
      );
    }
    logger.info({ event: 'deleteExclusionsBySchedule_success', count: items.length });
    return items.length;
  } catch (err) {
    logger.error({ event: 'deleteExclusionsBySchedule_error', err: serializeError(err) });
    throw err;
  }
}

function mapItemToScheduleEntry(
  item: Record<string, unknown>,
  organizationId: string,
  scheduleId: string,
): ScheduleEntry {
  return {
    scheduleId,
    organizationId: (item.organizationId as string) || organizationId,
    scheduleType: (item.scheduleType as ScheduleEntry['scheduleType']) || 'MEETING',
    scheduleTitle: item.scheduleTitle as string | undefined,
    scheduleNote: item.scheduleNote as string | undefined,
    startDate: item.startDate as string,
    endDate: item.endDate as string,
    frequency: item.frequency as ScheduleEntry['frequency'],
    dayOfWeek: item.dayOfWeek as string[] | undefined,
    timeSlots: item.timeSlots as ScheduleEntry['timeSlots'],
    leaveType: item.leaveType as ScheduleEntry['leaveType'],
    isEnabled: item.isEnabled as boolean | undefined,
    queueCapacity: item.queueCapacity as number | undefined,
    maxCapacity: item.maxCapacity as number | undefined,
    createdAt: item.createdAt as number | undefined,
    modifiedAt: item.modifiedAt as number | undefined,
    isDeleted: item.isDeleted as boolean | undefined,
  };
}
