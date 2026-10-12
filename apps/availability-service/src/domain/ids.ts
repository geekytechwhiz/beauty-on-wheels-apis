import { createHash, randomUUID } from 'crypto';

export function deterministicSlotId(
  vendorId: string,
  branchId: string,
  date: string,
  startTime: string,
): string {
  const digest = createHash('sha256')
    .update(`${vendorId}|${branchId}|${date}|${startTime}`)
    .digest('hex')
    .slice(0, 24);
  return `slot_${digest}`;
}

export function newHoldId(): string {
  return `hold_${randomUUID()}`;
}

export function newHolidayId(): string {
  return `hday_${randomUUID()}`;
}
