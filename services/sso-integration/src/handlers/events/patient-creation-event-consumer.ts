import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';

import { Context, SQSEvent, SQSRecord } from 'aws-lambda';

import { getSSOUserServiceClient } from '../../clients/user-service.client';
import { getSSOConfig } from '../../config/sso-config';
import { AppointmentSyncService } from '../../services/appointment-sync.service';
 
import { AssignDoctorPayload } from '../../types/user-creation.type';

import { mapPatientEventToCreateUserPayload } from '../../mappers/patient-event.mapper';

import { buildSSORequestContext } from '../../utils/context-builder.util';
import { PatientCreationEvent } from '../../types/events';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * SQS handler
 */
export async function handler(
  event: SQSEvent,
  context?: Context
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {

  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, { awsRequestId });

  logger.info({
    event: 'patient_creation_consumer_start',
    recordCount: event.Records.length,
  });

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {

    const recordId = record.messageId;

    const correlationId =
      (record.attributes?.MessageGroupId as string) ||
      awsRequestId ||
      'unknown';

    try {
      await processPatientCreationEvent(record, correlationId, logger);
    } catch (error) {

      logger.error({
        event: 'patient_creation_consumer_error',
        recordId,
        correlationId,
        err: serializeError(error as Error),
      });

      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  logger.info({
    event: 'patient_creation_consumer_complete',
    totalRecords: event.Records.length,
    failures: batchItemFailures.length,
  });

  return { batchItemFailures };
}

/**
 * Processes a single patient creation event
 */
async function processPatientCreationEvent(
  record: SQSRecord,
  correlationId: string,
  logger: ReturnType<typeof createChildLogger>
): Promise<void> {

  const userServiceClient = getSSOUserServiceClient();
  const config = getSSOConfig();

  let event: PatientCreationEvent;

  /**
   * Parse event
   */
  try {
    event = JSON.parse(record.body) as PatientCreationEvent;
  } catch (error) {

    logger.error({
      event: 'patient_creation_event_parse_error',
      recordId: record.messageId,
      err: serializeError(error as Error),
    });

    throw new Error('Invalid patient creation event');
  }

  const { patient, doctorId, organizationID, provider, externalId } = event.data;

  /**
   * Validate event – non-retryable issues are logged and skipped
   * so they do not poison the queue / DLQ.
   */
  if (!patient?.id || !externalId) {
    logger.error({
      event: 'patient_creation_event_invalid',
      reason: 'missing_patient_or_external_id',
      patientId: patient?.id,
      externalId,
    });
    return;
  }

  logger.info({
    event: 'patient_creation_event_process_start',
    patientId: patient.id,
    patientName: patient.name,
    doctorId,
    organizationID,
    provider,
  });

  /**
   * Build request context
   */
  const context = buildSSORequestContext(event, correlationId);

  /**
   * Check if user already exists
   */
  const existingPatient = await userServiceClient.findUserByExternalId(
    { externalId },
    context
  );

  if (existingPatient) {

    logger.info({
      event: 'patient_creation_event_skipped',
      reason: 'patient_already_exists',
      patientId: patient.id,
      userId: existingPatient.id,
    });

    return;
  }

  /**
   * Map event → createUser payload
   */
  const patientPayload = mapPatientEventToCreateUserPayload(event);

  logger.info({
    event: 'patient_creation_event_mapped_payload',
    correlationId,
    patientId: patient.id,
    userType: patientPayload.userType,
    userRole: patientPayload.userRole,
    organizationID: patientPayload.organizationID || organizationID,
  });

  const hasEmail =
    typeof patientPayload.userInfo.contact.email === 'string' &&
    patientPayload.userInfo.contact.email.trim() !== '';
  const hasPhone =
    typeof patientPayload.userInfo.contact.phone === 'string' &&
    patientPayload.userInfo.contact.phone.trim() !== '';

  if (!hasEmail && !hasPhone) {
    logger.error({
      event: 'patient_creation_event_invalid_contact',
      reason: 'missing_email_and_phone',
      patientId: patient.id,
    });
    // Do not throw – message is considered invalid and is safely skipped.
    return;
  }

  /**
   * Fallback organization
   */
  patientPayload.organizationID =
    organizationID || config.defaultOrganizationID;

  /**
   * Create patient
   */
  const createdPatient = await userServiceClient.createPatient(
    patientPayload,
    context
  );

  logger.info({
    event: 'patient_creation_event_success',
    patientId: patient.id,
    userId: createdPatient.id,
  });

  /**
   * Assign doctor
   */
  if (doctorId) {

    const assignDoctorPayload: AssignDoctorPayload = {
      organizationId: patientPayload.organizationID,

      sender: {
        userId: String(doctorId),
      },

      receiver: {
        userId: String(createdPatient.id),
        name: patient.name,
        email: patient.email ?? undefined,
        userType: 'MOBILE',
      },
    };

    const assignResult = await userServiceClient.assignDoctor(
      assignDoctorPayload,
      context
    );

    logger.info({
      event: 'patient_assign_doctor_success',
      patientId: patient.id,
      userId: createdPatient.id,
      doctorId,
      organizationId: patientPayload.organizationID,
      message: assignResult?.message,
    });
  }

  /**
   * Reprocess pending appointments
   */
  try {

    const appointmentSyncService = new AppointmentSyncService();

    await appointmentSyncService.syncAppointments(context);

    logger.info({
      event: 'pending_appointments_reprocess_triggered',
      patientExternalId: externalId,
      userId: createdPatient.id,
    });

  } catch (error) {

    logger.error({
      event: 'pending_appointments_reprocess_failed',
      patientExternalId: externalId,
      err: serializeError(error as Error),
    });
  }
}