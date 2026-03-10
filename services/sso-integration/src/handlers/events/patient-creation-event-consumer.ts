import { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { createLogger, createChildLogger, extractAwsRequestId, serializeError } from '@api-hub/logger';
import { getSSOConfig } from '../../config/sso-config';
import { getPatientMapperHelper } from '../../helper/patient.mapper';
import { getSSOUserServiceClient } from '../../clients/user-service.client'; 
import { PatientCreationEvent } from '../../types/events';
import { getAppointmentSyncService } from '../../services/appointment-sync.service';
import { buildSchedulerContext } from '../../context/context-factory';
 
const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });
export async function handler(event: SQSEvent, context?: Context): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
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
  const userServiceClient = getSSOUserServiceClient();
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

  const { patient, doctorId, organizationID, provider, externalId } = event.data;
  const tenantId = "default"; // TODO: get tenantId from event

  logger.info({
    event: 'patient_creation_event_process_start',
    patientId: patient.id,
    patientName: patient.name,
    doctorId,
    organizationID,
  });

  // Generate service token for user service authentication
   
  const context = await buildSchedulerContext(
    tenantId,
    correlationId
  );

  // Check if patient already exists
  const existingPatient = await userServiceClient.findByExternalId(
    {
      provider,
      externalId,
      tenantId,
    },context
     
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
 

  // Get doctor name from event data (if provided) or use a default
  // The user service will handle doctor assignment properly even without the name
  const doctorName = 'Dr. Name'; // TODO: get doctor name from event

  // Map event patient data to Patient type expected by mapper
  const patientData = {
    id: patient.id,
    name: patient.name,
    email: patient.email,
    phone: patient.phone,
    gender: patient.gender,
    dateOfBirth: patient.dob || '',
    dob: patient.dob || null,
    mrn: patient.mrn || '',
    age: null,
    organizationId: organizationID,
  };

  const patientPayload = patientMapper.mapTruTechPatientToOurSystem(
    patientData,
    doctorId as string,
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
    context,
  );

  logger.info({
    event: 'patient_creation_event_success',
    patientId: patient.id,
    userId: createdPatient.id,
  });

  try {
    const appointmentSyncService = getAppointmentSyncService();
    await appointmentSyncService.reprocessPendingAppointments(
      externalId, 
      context
    );

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
