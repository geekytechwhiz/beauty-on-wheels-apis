import { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { createLogger, createChildLogger, extractAwsRequestId, serializeError } from '@api-hub/logger';
import { getUserServiceClient } from '../services/user.client';
import { getPatientMapperHelper } from '../utils/helper/patient.mapper.helper';
import { PatientCreationEvent } from '../services/patient-event-publisher.service';
import { getSSOConfig } from '../config/sso-config';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

/**
 * Lambda handler for processing patient creation events from SQS.
 * This runs asynchronously in the background and does not block the launch flow.
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
    const correlationId = record.attributes?.MessageGroupId as string || awsRequestId || 'unknown';

    try {
      await processPatientCreationEvent(record, correlationId, logger);
    } catch (error) {
      logger.error({
        event: 'patient_creation_consumer_error',
        recordId,
        correlationId,
        err: serializeError(error as Error),
      });

      // Add to batch failures for retry
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
 * Processes a single patient creation event.
 * 
 * @param record - SQS record containing patient creation event
 * @param correlationId - Correlation ID for logging
 * @param logger - Logger instance
 */
async function processPatientCreationEvent(
  record: SQSRecord,
  correlationId: string,
  logger: ReturnType<typeof createChildLogger>,
): Promise<void> {
  const userServiceClient = getUserServiceClient();
  const patientMapper = getPatientMapperHelper();
  const config = getSSOConfig();

  // Parse event from SQS record
  let event: PatientCreationEvent;
  try {
    event = JSON.parse(record.body) as PatientCreationEvent;
  } catch (error) {
    logger.error({
      event: 'patient_creation_event_parse_error',
      recordId: record.messageId,
      err: serializeError(error as Error),
    });
    throw new Error('Failed to parse patient creation event');
  }

  const { patient, doctorId, organizationID, tenantId, provider, externalId } = event.data;

  logger.info({
    event: 'patient_creation_event_process_start',
    patientId: patient.id,
    patientName: patient.name,
    doctorId,
    organizationID,
  });

  // Check if patient already exists
  const existingPatient = await userServiceClient.findByExternalId(
    {
      provider,
      externalId,
      tenantId,
    },
    correlationId,
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

  // Map patient data to our system format
  // We need to reconstruct the Patient object from event data
  const patientData: import('../types').Patient = {
    id: patient.id,
    mrn: patient.mrn || '',
    name: patient.name,
    gender: patient.gender,
    age: '', // Not needed for creation
    dateOfBirth: patient.dob || '',
    phone: patient.phone,
    email: patient.email,
  };

  // Get doctor name from event data (if provided) or use a default
  // The user service will handle doctor assignment properly even without the name
  const doctorName = event.data.doctorName || 'Dr. Name';

  const patientPayload = patientMapper.mapTruTechPatientToOurSystem(
    patientData,
    doctorId,
    doctorName,
    correlationId,
  );

  // Override organizationID from event if provided
  if (organizationID) {
    patientPayload.organizationID = organizationID;
  } else {
    // Fallback to config default
    patientPayload.organizationID = config.defaultOrganizationID;
  }

  // Create patient
  const createdPatient = await userServiceClient.createPatient(
    patientPayload,
    externalId,
    provider,
    tenantId,
    correlationId,
  );

  logger.info({
    event: 'patient_creation_event_success',
    patientId: patient.id,
    userId: createdPatient.id,
  });
}
