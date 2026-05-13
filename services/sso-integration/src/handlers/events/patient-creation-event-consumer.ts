import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/observability';

import { Context, SQSevent: any, SQSRecord } from 'aws-lambda';

import { getSSOUserServiceClient } from '../../clients/user-service.client';
import { publishPendingReprocess } from '../../services/appointment-sync/pending-reprocess-queue.service';

import {
  mapHmsPatientToCreatePatientModel,
  buildAssignDoctorPayload,
} from '../../mappers/user-creation.mapper';

import { buildSSORequestContextFromSQS } from '../../utils/context-builder.util';
import { PatientCreationEvent } from '../../types/events';
import { UserExistenceValidator } from '../../validators/user-existence.validator';
import { CognitoService } from '../../services/cognito.service';
import { getOrganizationRoleIds } from '../../services/organization-role.service';
import { getEnvConfig } from '../../config/env';
import { getExternalTenantsByProvider } from '../../services/external-tenant.service';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * SQS handler
 */
export async function handler(
  event: SQSevent: any,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {

  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, { awsRequestId });

  logger.info({
    event: 'patient_creation_consumer_start',
    recordCount: event.Records.length,
  });

  const env = getEnvConfig();
  await getExternalTenantsByProvider(env.PROVIDER);

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    const recordId = record.messageId;

    const correlationId =
      record.messageAttributes?.CorrelationId?.stringValue ||
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

  let event: PatientCreationEvent;
  const userExistenceValidator = new UserExistenceValidator(
    userServiceClient,
    new CognitoService(),
    logger,
  );
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
  // console.log('event.data in patient-creation-event-consumer', event.data);
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
  const requestContext = buildSSORequestContextFromSQS(event: any, correlationId);

  /**
   * Check if patient already exists
   */
 
  const existenceResult = await userExistenceValidator.checkUserExists(
    {
      externalId: externalId,
      email: patient.email ?? null,
      phone: patient.phone ?? null,
    },
    requestContext,
  );

  const resolvedOrganizationId = organizationID;
  if (!resolvedOrganizationId) {
    throw new Error('organizationID is required for patient creation flow');
  }
  let patientUserId: string | undefined;
  let usedExistingPatient = false;

  if (existenceResult.userServiceUser) {
    patientUserId = String(existenceResult.userServiceUser.id);
    usedExistingPatient = true;
    logger.info({
      event: 'patient_creation_event_existing_user_continue',
      reason: 'patient_already_exists',
      patientId: patient.id,
      externalId,
      userId: patientUserId,
    });
  }

  if (existenceResult.cognitoUser) {
    logger.info({
      event: 'patient_creation_event_found_in_cognito_creating_user_service_record',
      patientId: patient.id,
      externalId,
      userId: existenceResult.cognitoUser.userId,
      organizationId: existenceResult.cognitoUser.organizationId,
    });
  }

  /**
   * Map event → createUser payload (CreatePatientModel)
   */
  if (!patientUserId) {
    const roleIds = await getOrganizationRoleIds(resolvedOrganizationId, requestContext);
    const patientPayload = mapHmsPatientToCreatePatientModel(event: any, roleIds);

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
    patientPayload.organizationID = resolvedOrganizationId;

    /**
     * Create patient
     */
    const createdPatient = await userServiceClient.createPatient(
      patientPayload,
      requestContext,
    );

    /**
     * Extract patient userId (CreatedUserInfo.userId)
     */
    patientUserId = createdPatient?.userId;


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
  }
  /**
   * Assign doctor if provided (AssignDoctorModel; sender ≠ receiver enforced)
   */
  if (doctorId) {
    logger.info({
      event: 'patient_assign_doctor_attempt',
      patientId: patient.id,
      userId: patientUserId,
      doctorId,
      organizationId: resolvedOrganizationId,
      assignmentSource: usedExistingPatient ? 'existing_patient' : 'newly_created_patient',
    });

    const assignDoctorPayload = buildAssignDoctorPayload({
      organizationId: resolvedOrganizationId,
      doctorUserId: String(doctorId),
      patientUserId: String(patientUserId),
      doctor: { userType: 'STAFF' },
      patient: {
        name: patient.name,
        email: patient.email ?? undefined,
        userType: 'USER',
      },
    });

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
        organizationId: resolvedOrganizationId,
        message: assignResult?.message,
      });
    } catch (error) {
      logger.error({
        event: 'patient_assign_doctor_failed',
        patientId: patient.id,
        userId: patientUserId,
        doctorId,
        organizationId: resolvedOrganizationId,
        err: serializeError(error as Error),
      });
    }
  } else {
    logger.warn({
      event: 'patient_assign_doctor_skipped',
      reason: 'doctor_id_missing_in_event',
      patientId: patient.id,
      userId: patientUserId,
      organizationId: resolvedOrganizationId,
    });
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