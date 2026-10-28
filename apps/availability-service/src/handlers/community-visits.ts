import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { getCommunityVisitsService } from '../services/community-visits.service';
import { headerValue, parseLimit, pathParam, queryValue } from '../utils/request';

const service = getCommunityVisitsService();

function idempotencyKey(request: LambdaRequest): string {
  const key = headerValue(request, 'idempotency-key');
  if (!key || key.length > 128) throw new ValidationError('Idempotency-Key is required');
  return key;
}

function body(request: LambdaRequest): Record<string, unknown> {
  return request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
}

function numberValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ValidationError(`${field} must be a whole number`);
  return value;
}

export const handleListCommunityVisitSchedules = withApiHandler({ operation: 'listcommunityvisitschedules' }, async (request: LambdaRequest) => (
  service.listSchedules(request, pathParam(request, 'vendorId'))
));

export const handlePublishCommunityVisitSchedule = withApiHandler({ operation: 'publishcommunityvisitschedule' }, async (request: LambdaRequest) => {
  const input = body(request);
  return service.publish(request, pathParam(request, 'vendorId'), {
    communityId: requiredText(input.communityId, 'communityId'),
    communityName: optionalText(input.communityName),
    locality: optionalText(input.locality),
    city: optionalText(input.city),
    timezone: requiredText(input.timezone, 'timezone'),
    days: Array.isArray(input.days) ? input.days.map((day) => numberValue(day, 'days')) : [],
    startTime: requiredText(input.startTime, 'startTime'),
    endTime: requiredText(input.endTime, 'endTime'),
    effectiveDate: requiredText(input.effectiveDate, 'effectiveDate'),
    capacity: numberValue(input.capacity, 'capacity'),
    bookingCutoffMinutes: numberValue(input.bookingCutoffMinutes, 'bookingCutoffMinutes'),
    oneOff: input.oneOff === true,
    expectedVersion: input.expectedVersion === undefined ? undefined : numberValue(input.expectedVersion, 'expectedVersion'),
    idempotencyKey: idempotencyKey(request),
  });
});

export const handleListCommunityVisits = withApiHandler({ operation: 'listcommunityvisits' }, async (request: LambdaRequest) => (
  service.listVisits(request, pathParam(request, 'vendorId'), {
    fromDate: queryValue(request, 'fromDate') ?? queryValue(request, 'from'),
    toDate: queryValue(request, 'toDate') ?? queryValue(request, 'to'),
    communityId: queryValue(request, 'communityId'),
    limit: parseLimit(queryValue(request, 'limit') ?? '20'),
    cursor: queryValue(request, 'cursor') ?? queryValue(request, 'nextToken'),
  })
));

export const handleDeactivateCommunityVisitSchedule = withApiHandler({ operation: 'deactivatecommunityvisitschedule' }, async (request: LambdaRequest) => {
  const input = body(request);
  return service.deactivateSchedule(request, pathParam(request, 'vendorId'), pathParam(request, 'scheduleId'), {
    expectedVersion: numberValue(input.expectedVersion, 'expectedVersion'),
    idempotencyKey: idempotencyKey(request),
  });
});

export const handleUnblockCommunityVisit = withApiHandler({ operation: 'unblockcommunityvisit' }, async (request: LambdaRequest) => {
  const input = body(request);
  return service.unblock(request, pathParam(request, 'vendorId'), pathParam(request, 'visitId'), {
    expectedVersion: numberValue(input.expectedVersion, 'expectedVersion'),
    idempotencyKey: idempotencyKey(request),
  });
});

/** Canonical customer availability: bookable community visit occurrences. */
export const handleListCommunityAvailability = withApiHandler({ operation: 'listcommunityavailability' }, async (request: LambdaRequest) => {
  const fromDate = queryValue(request, 'fromDate') ?? queryValue(request, 'date');
  const toDate = queryValue(request, 'toDate') ?? queryValue(request, 'date') ?? fromDate;
  if (!fromDate || !toDate) throw new ValidationError('fromDate and toDate (or date) are required');
  return service.listBookableOccurrences(request, {
    communityId: pathParam(request, 'communityId'),
    fromDate,
    toDate,
    vendorId: queryValue(request, 'vendorId'),
    limit: parseLimit(queryValue(request, 'limit')),
    cursor: queryValue(request, 'nextToken') ?? queryValue(request, 'cursor'),
  });
});

export const handleUpdateCommunityVisitCapacity = withApiHandler({ operation: 'updatecommunityvisitcapacity' }, async (request: LambdaRequest) => {
  const input = body(request);
  return service.updateCapacity(request, pathParam(request, 'vendorId'), pathParam(request, 'visitId'), {
    capacity: numberValue(input.capacity, 'capacity'),
    expectedVersion: numberValue(input.expectedVersion, 'expectedVersion'),
    idempotencyKey: idempotencyKey(request),
  });
});

export const handleCancelCommunityVisit = withApiHandler({ operation: 'cancelcommunityvisit' }, async (request: LambdaRequest) => {
  const input = body(request);
  return service.cancel(request, pathParam(request, 'vendorId'), pathParam(request, 'visitId'), {
    expectedVersion: numberValue(input.expectedVersion, 'expectedVersion'),
    idempotencyKey: idempotencyKey(request),
  });
});

export const handleListCommunityVisitBookings = withApiHandler({ operation: 'listcommunityvisitbookings' }, async (request: LambdaRequest) => (
  service.listBookingRefs(request, pathParam(request, 'vendorId'), pathParam(request, 'visitId'))
));

export const handleReserveCommunityVisit = withApiHandler({ operation: 'reservecommunityvisit' }, async (request: LambdaRequest) => {
  const input = body(request);
  return service.reserve(request, pathParam(request, 'vendorId'), pathParam(request, 'visitId'), {
    bookingId: requiredText(input.bookingId, 'bookingId'),
    units: input.units === undefined ? 1 : numberValue(input.units, 'units'),
    staffId: optionalText(input.staffId),
    idempotencyKey: idempotencyKey(request),
  });
});

export const handleReleaseCommunityVisit = withApiHandler({ operation: 'releasecommunityvisit' }, async (request: LambdaRequest) => (
  service.release(request, pathParam(request, 'vendorId'), pathParam(request, 'visitId'), pathParam(request, 'bookingId'))
));

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
