import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';

import { Context, SQSEvent, SQSRecord } from 'aws-lambda';

import { getSSOUserServiceClient } from '../../clients/user-service.client';
import { getSSOConfig } from '../../config/sso-config';
import { publishPendingReprocess } from '../../services/appointment-sync/pending-reprocess-queue.service';

import { AssignDoctorPayload } from '../../types/user-creation.type';
import { mapPatientEventToCreateUserPayload } from '../../mappers/patient-event.mapper';

import { buildSSORequestContextFromSQS } from '../../utils/context-builder.util';
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
  context?: Context,
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
      record.attributes?.MessageGroupId ||
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
  logger: ReturnType<typeof createChildLogger>,
): Promise<void> {

  const userServiceClient = getSSOUserServiceClient();
  const config = getSSOConfig();

  let event: PatientCreationEvent;

  /**
   * Parse SQS body
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

  const { patient, doctorId, provider, externalId, organizationID, } = event.data;
  console.log('event.data in patient-creation-event-consumer', event.data);
  /**
   * Validate event
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
  const requestContext = buildSSORequestContextFromSQS(event, correlationId);

  /**
   * Check if patient already exists
   */
  const existingPatient = await userServiceClient.findUserByExternalId(
    { externalId },
    requestContext,
  );

  if (existingPatient) {
    logger.info({
      event: 'patient_creation_event_skipped',
      reason: 'patient_already_exists',
      patientId: patient.id,
      externalId,
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
  });

  /**
   * Validate contact info
   */
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
    requestContext,
  );
  console.log('createdPatient in patient-creation-event-consumer', createdPatient);
  /**
   * Extract patient userId safely
   */ 
  const patientUserId=createdPatient?.invitedUser??createdPatient.invitedUser.userId??createdPatient.id; 


  if (!patientUserId) {
    logger.error({
      event: 'patient_creation_missing_user_id',
      patientId: patient.id,
      response: createdPatient,
    });

    return;
  }

  logger.info({
    event: 'patient_creation_event_success',
    patientId: patient.id,
    userId: patientUserId,
  });
//   {
//     "organizationId": "mm3208au877eaa2d",
//     "sender": {
//         "userType": "STAFF",
//         "userId": "01KJC8S5RZDG19EGT3XM5Y7XG3",
//         "profileImage": "d2zvxvbt9m8l3w.cloudfront.net/profile-picture/01KJC8S5RZDG19EGT3XM5Y7XG3/1772177136053",
//         "presenceStatus": "ONLINE",
//         "name": "doc cardio",
//         "email": "doc.paper.c@yopmail.com"
//     },
//     "receiver": {
//         "userId": "01KKGXREYGDRZCCY6AP6YKZQGC",
//         "name": "Sanjose",
//         "email": "sanjo.paper@yopmail.com",
//         "profileImage": "",
//         "userType": "MOBILE",
//         "presenceStatus": "OFFLINE"
//     }
// }
  /**
   * Assign doctor if provided
   */
  if (doctorId) {

    const assignDoctorPayload: AssignDoctorPayload = {
      organizationId: patientPayload.organizationID,

      sender: {
        userId: String(doctorId),
        name: 'doc cardio',
        email: 'doc.paper.c@yopmail.com',
        userType: 'STAFF',
        presenceStatus: 'ONLINE',
      },

      receiver: {
        userId: String(patientUserId),
        name: patient.name,
        email: patient.email ?? undefined,
        userType: 'MOBILE',
      },
    };

    try {
      const assignResult = await userServiceClient.assignDoctor(
        assignDoctorPayload,
        requestContext,
      );

      logger.info({
        event: 'patient_assign_doctor_success',
        patientId: patient.id,
        userId: patientUserId,
        doctorId,
        organizationId: patientPayload.organizationID,
        message: assignResult?.message,
      });
    } catch (error) {
      logger.error({
        event: 'patient_assign_doctor_failed',
        patientId: patient.id,
        userId: patientUserId,
        doctorId,
        organizationId: patientPayload.organizationID,
        err: serializeError(error as Error),
      });
    }
  }

  /**
   * Publish to PendingAppointmentReprocessQueue so worker re-enqueues pending appointments to AQ.
   * Do not reprocess inline; keeps consumer lightweight.
   */
  try {
    await publishPendingReprocess({
      tenantId: requestContext.tenantId,
      patientExternalId: externalId,
      correlationId,
    });

    logger.info({
      event: 'pending_reprocess_enqueued',
      tenantId: requestContext.tenantId,
      patientExternalId: externalId,
      correlationId,
      userId: patientUserId,
    });
  } catch (error) {
    logger.error({
      event: 'pending_reprocess_enqueue_failed',
      patientExternalId: externalId,
      err: serializeError(error as Error),
    });
  }
}