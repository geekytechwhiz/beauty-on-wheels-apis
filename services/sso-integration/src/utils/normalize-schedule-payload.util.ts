import { CreateServiceScheduleRequest } from '../types';

type ScheduleAction = 'createSchedule' | 'createSession';

type SchedulePayloadWithAction = Omit<CreateServiceScheduleRequest, 'action'> & {
  action: ScheduleAction;
};

const DEFAULT_LOCATION = 'N/A';
const DEFAULT_PINCODE = '000000';
const DEFAULT_COORDINATE = 0;
const DEFAULT_USER_NAME = 'Unknown User';
const DEFAULT_STAFF_NAME = 'Unknown Staff';
const DEFAULT_STAFF_SPECIALTY = 'general';

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toNumberOrDefault(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return fallback;
}

function buildFallbackEmail(prefix: 'user' | 'staff', id?: string): string {
  const normalizedId = toTrimmedString(id)?.replace(/[^a-zA-Z0-9._-]/g, '-');
  if (normalizedId) {
    return `${prefix}-${normalizedId}@placeholder.local`;
  }

  return `${prefix}@placeholder.local`;
}

/**
 * Normalizes scheduler create payload into a format accepted by downstream Scheduler service.
 * Keeps existing valid fields intact and only fills/derives missing values.
 */
export function normalizeSchedulePayload(
  payload: CreateServiceScheduleRequest,
): SchedulePayloadWithAction {
  const derivedStaffId =
    toTrimmedString(payload.staffId) ?? toTrimmedString(payload.doctorUserId) ?? '';
  const derivedUserId =
    toTrimmedString(payload.userId) ?? toTrimmedString(payload.patientUserId) ?? '';

  const userName =
    toTrimmedString(payload.userName) ??
    toTrimmedString(payload.userId) ??
    toTrimmedString(payload.patientUserId) ??
    DEFAULT_USER_NAME;

  const staffName =
    toTrimmedString(payload.staffName) ??
    toTrimmedString(payload.staffId) ??
    toTrimmedString(payload.doctorUserId) ??
    DEFAULT_STAFF_NAME;

  const normalizedAction: ScheduleAction =
    payload.action === 'createSession' || payload.action === 'createSchedule'
      ? payload.action
      : 'createSchedule';

  return {
    ...payload,
    action: normalizedAction,
    userId: derivedUserId,
    staffId: derivedStaffId,
    // patientUserId: toTrimmedString(payload.patientUserId) ?? derivedUserId,
    // doctorUserId: toTrimmedString(payload.doctorUserId) ?? derivedStaffId,
    userName,
    userEmail:
      toTrimmedString(payload.userEmail) ?? buildFallbackEmail('user', derivedUserId),
    staffName,
    staffEmail:
      toTrimmedString(payload.staffEmail) ?? buildFallbackEmail('staff', derivedStaffId),
    staffSpecialty:
      toTrimmedString(payload.staffSpecialty) ?? DEFAULT_STAFF_SPECIALTY,
    location: toTrimmedString(payload.location) ?? DEFAULT_LOCATION,
    pincode: toTrimmedString(payload.pincode) ?? DEFAULT_PINCODE,
    latitude: toNumberOrDefault(payload.latitude, DEFAULT_COORDINATE),
    longitude: toNumberOrDefault(payload.longitude, DEFAULT_COORDINATE),
  };
}
