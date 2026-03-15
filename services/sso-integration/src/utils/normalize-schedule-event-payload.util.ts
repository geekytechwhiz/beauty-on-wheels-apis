import {
  LegacyScheduleCreationMessage,
  ScheduleCreationEventPayload,
  ScheduleCreationParticipantPayload,
  ScheduleCreationQueueMessage,
} from '../types/events/schedule-creation-message.types';

type LegacyEntity = Record<string, unknown> | undefined;

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function isNormalizedScheduleEventPayload(
  value: ScheduleCreationQueueMessage,
): value is ScheduleCreationEventPayload {
  const event = value as ScheduleCreationEventPayload;

  return Boolean(
    toNonEmptyString(event?.tenantId) &&
      toNonEmptyString(event?.correlationId) &&
      toNonEmptyString(event?.appointment?.externalId) &&
      toNonEmptyString(event?.appointment?.startTime) &&
      toNonEmptyString(event?.appointment?.endTime) &&
      toNonEmptyString(event?.appointment?.status) &&
      toNonEmptyString(event?.doctor?.userId) &&
      toNonEmptyString(event?.doctor?.externalUserId) &&
      toNonEmptyString(event?.doctor?.organizationId) &&
      toNonEmptyString(event?.patient?.userId) &&
      toNonEmptyString(event?.patient?.externalUserId) &&
      toNonEmptyString(event?.patient?.organizationId),
  );
}

function normalizeParticipant(params: {
  legacyEntity: LegacyEntity;
  fallbackUserId?: unknown;
  fallbackExternalUserId?: unknown;
  fallbackOrganizationId?: unknown;
  label: 'doctor' | 'patient';
}): ScheduleCreationParticipantPayload {
  const { legacyEntity, fallbackUserId, fallbackExternalUserId, fallbackOrganizationId, label } =
    params;

  const userId =
    toNonEmptyString(legacyEntity?.userId) ??
    toNonEmptyString(legacyEntity?.id) ??
    toNonEmptyString(legacyEntity?.userID) ??
    toNonEmptyString(legacyEntity?.invitedUser) ??
    toNonEmptyString(fallbackUserId);

  const externalUserId =
    toNonEmptyString(legacyEntity?.externalUserId) ??
    toNonEmptyString(legacyEntity?.externalId) ??
    toNonEmptyString(fallbackExternalUserId);

  const organizationId =
    toNonEmptyString(legacyEntity?.organizationId) ??
    toNonEmptyString(legacyEntity?.organizationID) ??
    toNonEmptyString(fallbackOrganizationId);

  if (!userId || !externalUserId || !organizationId) {
    throw new Error(`Legacy schedule message is missing normalized ${label} identifiers`);
  }

  return {
    userId,
    externalUserId,
    organizationId,
  };
}

function normalizeLegacyScheduleCreationMessage(
  message: LegacyScheduleCreationMessage,
): ScheduleCreationEventPayload {
  const appointment = message.appointment;
  const tenantId = toNonEmptyString(message.tenantId);
  const correlationId = toNonEmptyString(message.correlationId);
  const appointmentExternalId =
    toNonEmptyString(message.appointmentExternalId) ??
    toNonEmptyString(appointment?.appointmentId);
  const appointmentStartTime = toNonEmptyString(appointment?.startTime);
  const appointmentEndTime = toNonEmptyString(appointment?.endTime);
  const appointmentStatus = toNonEmptyString(appointment?.status);

  if (
    !tenantId ||
    !correlationId ||
    !appointmentExternalId ||
    !appointmentStartTime ||
    !appointmentEndTime ||
    !appointmentStatus
  ) {
    throw new Error(
      'Legacy schedule message is missing appointment identifiers required for normalization',
    );
  }

  const legacyDoctor = (message.doctor ?? undefined) as LegacyEntity;
  const legacyPatient = (message.patientUser ?? undefined) as LegacyEntity;

  const doctor = normalizeParticipant({
    legacyEntity: legacyDoctor,
    fallbackExternalUserId: appointment?.doctor?.id,
    label: 'doctor',
  });

  const patient = normalizeParticipant({
    legacyEntity: legacyPatient,
    fallbackUserId: message.userId,
    fallbackExternalUserId: appointment?.patient?.id,
    fallbackOrganizationId:
      legacyDoctor?.organizationId ?? legacyDoctor?.organizationID ?? doctor.organizationId,
    label: 'patient',
  });

  return {
    tenantId,
    correlationId,
    appointment: {
      externalId: appointmentExternalId,
      startTime: appointmentStartTime,
      endTime: appointmentEndTime,
      status: appointmentStatus,
    },
    doctor,
    patient,
  };
}

export function normalizeScheduleEventPayload(
  payload: ScheduleCreationQueueMessage,
): ScheduleCreationEventPayload {
  if (isNormalizedScheduleEventPayload(payload)) {
    return {
      tenantId: payload.tenantId,
      correlationId: payload.correlationId,
      appointment: {
        externalId: payload.appointment.externalId,
        startTime: payload.appointment.startTime,
        endTime: payload.appointment.endTime,
        status: payload.appointment.status,
      },
      doctor: {
        userId: payload.doctor.userId,
        externalUserId: payload.doctor.externalUserId,
        organizationId: payload.doctor.organizationId,
      },
      patient: {
        userId: payload.patient.userId,
        externalUserId: payload.patient.externalUserId,
        organizationId: payload.patient.organizationId,
      },
    };
  }

  return normalizeLegacyScheduleCreationMessage(payload);
}
