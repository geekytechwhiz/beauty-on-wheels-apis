/**
 * DynamoDB slot capacity helpers.
 *
 * Invariant:
 * availableCount = capacity - bookedCount - heldCount
 *
 * All counter writers must preserve this invariant.
 */

export interface CapacitySnapshot {
  capacity: number;
  bookedCount: number;
  heldCount: number;
}

export interface SlotCapacityTarget extends CapacitySnapshot {
  PK: string;
  SK: string;
}

export type CapacityCounter = 'bookedCount' | 'heldCount';

type ExpressionValues = Record<string, string | number>;

export interface CapacityUpdate {
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: ExpressionValues;
}

const OPEN_SLOT = 'attribute_exists(PK) AND #status = :available';

export const CAPACITY_NAMES = {
  '#capacity': 'capacity',
};

export const OPEN_CAPACITY_NAMES = {
  ...CAPACITY_NAMES,
  '#status': 'status',
};

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateSnapshot(snapshot: CapacitySnapshot): void {
  const { capacity, bookedCount, heldCount } = snapshot;

  if (
    !isNonNegativeInteger(capacity) ||
    !isNonNegativeInteger(bookedCount) ||
    !isNonNegativeInteger(heldCount)
  ) {
    throw new Error('INVALID_SLOT_CAPACITY_SNAPSHOT');
  }

  if (bookedCount > capacity || heldCount > capacity - bookedCount) {
    throw new Error('SLOT_CAPACITY_INCONSISTENT');
  }
}

function validateUnits(units: number): void {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error('INVALID_CAPACITY_UNITS');
  }
}

function validateTimestamp(now: string): void {
  if (!now || !Number.isFinite(Date.parse(now))) {
    throw new Error('INVALID_TIMESTAMP');
  }
}

export function remainingFromSnapshot(snapshot: CapacitySnapshot): number {
  validateSnapshot(snapshot);

  return snapshot.capacity - snapshot.bookedCount - snapshot.heldCount;
}

function snapshotCondition(): string {
  return [
    '#capacity = :capacity',
    'bookedCount = :bookedCount',
    'heldCount = :heldCount',
  ].join(' AND ');
}

/**
 * Existing slots:
 * Check availableCount atomically.
 *
 * Legacy slots:
 * Require unchanged snapshot counters and capacity.
 */
export function consumeCapacityCondition(
  snapshot: CapacitySnapshot,
  units: number,
): string {
  const remaining = remainingFromSnapshot(snapshot);
  validateUnits(units);

  const live = `(${OPEN_SLOT} AND availableCount >= :units AND #capacity = :capacity)`;

  if (remaining < units) {
    return live;
  }

  const legacy = [
    `(${OPEN_SLOT}`,
    'AND attribute_not_exists(availableCount)',
    `AND ${snapshotCondition()})`,
  ].join(' ');

  return `${live} OR ${legacy}`;
}

export function consumeCapacityValues(
  snapshot: CapacitySnapshot,
  units: number,
  now: string,
): ExpressionValues {
  const remaining = remainingFromSnapshot(snapshot);
  validateUnits(units);
  validateTimestamp(now);

  const values: ExpressionValues = {
    ':units': units,
    ':now': now,
    ':available': 'available',
    ':availableSeed': remaining,
    ':capacity': snapshot.capacity,
  };

  if (remaining >= units) {
    values[':bookedCount'] = snapshot.bookedCount;
    values[':heldCount'] = snapshot.heldCount;
  }

  return values;
}

/**
 * One write covers initialized and legacy slots.
 * if_not_exists seeds availableCount from the validated snapshot,
 * then applies the same delta as the counter.
 */
export const CONSUME_BOOKED_UPDATE =
  'SET bookedCount = bookedCount + :units, ' +
  'availableCount = if_not_exists(availableCount, :availableSeed) - :units, ' +
  'updatedAt = :now';

export const CONSUME_HELD_UPDATE =
  'SET heldCount = heldCount + :units, ' +
  'availableCount = if_not_exists(availableCount, :availableSeed) - :units, ' +
  'updatedAt = :now';

export const RESTORE_BOOKED_UPDATE =
  'SET bookedCount = bookedCount - :units, ' +
  'availableCount = if_not_exists(availableCount, :availableSeed) + :units, ' +
  'updatedAt = :now';

export const RESTORE_HELD_UPDATE =
  'SET heldCount = heldCount - :units, ' +
  'availableCount = if_not_exists(availableCount, :availableSeed) + :units, ' +
  'updatedAt = :now';

/**
 * Restoration requires sufficient counter units.
 *
 * Legacy records require an unchanged snapshot.
 */
export function restoreCapacityCondition(counter: CapacityCounter): string {
  const base = `attribute_exists(PK) AND ${counter} >= :units`;

  const live = [
    `(${base}`,
    'AND attribute_exists(availableCount)',
    'AND availableCount <= :maxAvailable',
    'AND #capacity = :capacity)',
  ].join(' ');

  const legacy = [
    `(${base}`,
    'AND attribute_not_exists(availableCount)',
    `AND ${snapshotCondition()})`,
  ].join(' ');

  return `${live} OR ${legacy}`;
}

export function restoreCapacityValues(
  snapshot: CapacitySnapshot,
  units: number,
  now: string,
): ExpressionValues {
  const remaining = remainingFromSnapshot(snapshot);
  validateUnits(units);
  validateTimestamp(now);

  if (remaining + units > snapshot.capacity) {
    throw new Error('SLOT_CAPACITY_EXCEEDED');
  }

  return {
    ':units': units,
    ':now': now,
    ':availableSeed': remaining,
    ':capacity': snapshot.capacity,
    ':bookedCount': snapshot.bookedCount,
    ':heldCount': snapshot.heldCount,
    ':maxAvailable': snapshot.capacity - units,
  };
}

/**
 * Build atomic capacity consumption update.
 *
 * legacy = true:
 * Initializes availableCount from the validated
 * snapshot and performs the mutation atomically.
 *
 * legacy = false:
 * Adjusts availableCount with the same delta as the counter.
 */
export function buildConsumeCapacityUpdate(
  snapshot: CapacitySnapshot,
  units: number,
  now: string,
  counter: CapacityCounter,
  legacy = false,
): CapacityUpdate {
  const remaining = remainingFromSnapshot(snapshot);
  validateUnits(units);
  validateTimestamp(now);

  if (remaining < units) {
    throw new Error('INSUFFICIENT_SLOT_CAPACITY');
  }

  if (legacy) {
    return {
      UpdateExpression: [
        `SET ${counter} = ${counter} + :units`,
        'availableCount = :newAvailableCount',
        'updatedAt = :now',
      ].join(', '),

      ConditionExpression: [
        OPEN_SLOT,
        'attribute_not_exists(availableCount)',
        snapshotCondition(),
      ].join(' AND '),

      ExpressionAttributeNames: {
        ...OPEN_CAPACITY_NAMES,
      },

      ExpressionAttributeValues: {
        ':units': units,
        ':newAvailableCount': remaining - units,
        ':now': now,
        ':available': 'available',
        ':capacity': snapshot.capacity,
        ':bookedCount': snapshot.bookedCount,
        ':heldCount': snapshot.heldCount,
      },
    };
  }

  return {
    UpdateExpression:
      counter === 'bookedCount' ? CONSUME_BOOKED_UPDATE : CONSUME_HELD_UPDATE,

    ConditionExpression: [
      OPEN_SLOT,
      'attribute_exists(availableCount)',
      'availableCount >= :units',
      '#capacity = :capacity',
    ].join(' AND '),

    ExpressionAttributeNames: {
      ...OPEN_CAPACITY_NAMES,
    },

    ExpressionAttributeValues: {
      ':units': units,
      ':now': now,
      ':available': 'available',
      ':availableSeed': remaining,
      ':capacity': snapshot.capacity,
    },
  };
}

/**
 * Build atomic capacity restoration update.
 *
 * Does not require slot status = available,
 * because a previously held or booked slot
 * may need restoration after being blocked.
 */
export function buildRestoreCapacityUpdate(
  snapshot: CapacitySnapshot,
  units: number,
  now: string,
  counter: CapacityCounter,
  legacy = false,
): CapacityUpdate {
  const remaining = remainingFromSnapshot(snapshot);
  validateUnits(units);
  validateTimestamp(now);

  if (snapshot[counter] < units) {
    throw new Error('INSUFFICIENT_COUNTER_UNITS');
  }

  if (remaining + units > snapshot.capacity) {
    throw new Error('SLOT_CAPACITY_EXCEEDED');
  }

  if (legacy) {
    return {
      UpdateExpression: [
        `SET ${counter} = ${counter} - :units`,
        'availableCount = :newAvailableCount',
        'updatedAt = :now',
      ].join(', '),

      ConditionExpression: [
        'attribute_exists(PK)',
        `${counter} >= :units`,
        'attribute_not_exists(availableCount)',
        snapshotCondition(),
      ].join(' AND '),

      ExpressionAttributeNames: {
        ...CAPACITY_NAMES,
      },

      ExpressionAttributeValues: {
        ':units': units,
        ':newAvailableCount': remaining + units,
        ':now': now,
        ':capacity': snapshot.capacity,
        ':bookedCount': snapshot.bookedCount,
        ':heldCount': snapshot.heldCount,
      },
    };
  }

  return {
    UpdateExpression:
      counter === 'bookedCount' ? RESTORE_BOOKED_UPDATE : RESTORE_HELD_UPDATE,

    ConditionExpression: [
      'attribute_exists(PK)',
      `${counter} >= :units`,
      'attribute_exists(availableCount)',
      'availableCount <= :maxAvailable',
      '#capacity = :capacity',
    ].join(' AND '),

    ExpressionAttributeNames: {
      ...CAPACITY_NAMES,
    },

    ExpressionAttributeValues: {
      ':units': units,
      ':now': now,
      ':availableSeed': remaining,
      ':maxAvailable': snapshot.capacity - units,
      ':capacity': snapshot.capacity,
    },
  };
}
