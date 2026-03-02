import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { Patient } from '../types';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export interface PatientCreationEvent {
  eventType: 'patient.creation.requested';
  eventId: string;
  timestamp: string;
  correlationId: string;
  data: {
    patient: {
      id: number;
      name: string;
      email?: string;
      phone?: string;
      gender: string;
      dob?: string;
      mrn?: string;
    };
    doctorId: string;
    doctorName?: string; // Doctor name for patient assignment
    organizationID: string;
    tenantId: string;
    provider: string;
    externalId: string;
  };
  metadata?: {
    retryCount?: number;
    source: 'sso-integration';
  };
}

/**
 * Service for publishing patient creation events to SQS event bus.
 * This enables event-driven, asynchronous patient creation processing.
 */
export class PatientEventPublisher {
  private readonly sqsClient: SQSClient;
  private readonly logger = createChildLogger(baseLogger, { component: 'PatientEventPublisher' });
  private readonly queueUrl: string;

  constructor(queueUrl?: string) {
    this.sqsClient = new SQSClient({});
    this.queueUrl = queueUrl || process.env.PATIENT_CREATION_QUEUE_URL || '';
    
    if (!this.queueUrl) {
      this.logger.warn({
        event: 'patient_event_publisher_queue_url_missing',
        message: 'PATIENT_CREATION_QUEUE_URL not set, event publishing will fail',
      });
    }
  }

  /**
   * Publishes a single patient creation event to SQS.
   * This is a fire-and-forget operation - does not wait for processing.
   * 
   * @param event - Patient creation event
   * @param correlationId - Correlation ID for logging
   */
  async publishPatientCreationEvent(
    event: PatientCreationEvent,
    correlationId: string,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, { correlationId });

    if (!this.queueUrl) {
      logger.warn({
        event: 'patient_event_publish_skipped',
        reason: 'queue_url_not_configured',
        patientId: event.data.patient.id,
      });
      return;
    }

    logger.info({
      event: 'patient_event_publish_start',
      patientId: event.data.patient.id,
      eventId: event.eventId,
    });

    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event),
        MessageAttributes: {
          EventType: {
            DataType: 'String',
            StringValue: event.eventType,
          },
          CorrelationId: {
            DataType: 'String',
            StringValue: correlationId,
          },
          Provider: {
            DataType: 'String',
            StringValue: event.data.provider,
          },
        },
      });

      await this.sqsClient.send(command);

      logger.info({
        event: 'patient_event_publish_success',
        patientId: event.data.patient.id,
        eventId: event.eventId,
      });
    } catch (error) {
      // Non-blocking: log error but don't throw
      logger.error({
        event: 'patient_event_publish_error',
        patientId: event.data.patient.id,
        eventId: event.eventId,
        err: serializeError(error as Error),
      });
      // Don't throw - event publishing failure should not block launch flow
    }
  }

  /**
   * Publishes multiple patient creation events in batch.
   * Uses SQS batch API for efficiency (up to 10 messages per batch).
   * 
   * @param events - Array of patient creation events
   * @param correlationId - Correlation ID for logging
   */
  async publishPatientCreationEventsBatch(
    events: PatientCreationEvent[],
    correlationId: string,
  ): Promise<void> {
    const logger = createChildLogger(this.logger, { correlationId });

    if (!this.queueUrl) {
      logger.warn({
        event: 'patient_event_batch_publish_skipped',
        reason: 'queue_url_not_configured',
        eventCount: events.length,
      });
      return;
    }

    if (events.length === 0) {
      logger.debug({
        event: 'patient_event_batch_publish_empty',
      });
      return;
    }

    logger.info({
      event: 'patient_event_batch_publish_start',
      eventCount: events.length,
    });

    // SQS batch API supports up to 10 messages per batch
    const batchSize = 10;
    const batches: PatientCreationEvent[][] = [];

    for (let i = 0; i < events.length; i += batchSize) {
      batches.push(events.slice(i, i + batchSize));
    }

    const publishPromises = batches.map(async (batch, batchIndex) => {
      try {
        const entries = batch.map((event, index) => ({
          Id: `${batchIndex}-${index}`,
          MessageBody: JSON.stringify(event),
          MessageAttributes: {
            EventType: {
              DataType: 'String',
              StringValue: event.eventType,
            },
            CorrelationId: {
              DataType: 'String',
              StringValue: correlationId,
            },
            Provider: {
              DataType: 'String',
              StringValue: event.data.provider,
            },
          },
        }));

        const command = new SendMessageBatchCommand({
          QueueUrl: this.queueUrl,
          Entries: entries,
        });

        await this.sqsClient.send(command);

        logger.info({
          event: 'patient_event_batch_publish_success',
          batchIndex,
          batchSize: batch.length,
        });
      } catch (error) {
        // Non-blocking: log error but don't throw
        logger.error({
          event: 'patient_event_batch_publish_error',
          batchIndex,
          batchSize: batch.length,
          err: serializeError(error as Error),
        });
        // Don't throw - event publishing failure should not block launch flow
      }
    });

    // Fire and forget - don't wait for all batches
    Promise.all(publishPromises).catch((error) => {
      logger.error({
        event: 'patient_event_batch_publish_unexpected_error',
        err: serializeError(error as Error),
      });
    });

    logger.info({
      event: 'patient_event_batch_publish_initiated',
      totalBatches: batches.length,
      totalEvents: events.length,
    });
  }

  /**
   * Creates a patient creation event from patient data.
   * 
   * @param patient - Patient data from TruTech
   * @param doctorId - Our system's doctor user ID
   * @param doctorName - Doctor name (optional, for patient assignment)
   * @param organizationID - Organization ID
   * @param tenantId - Tenant ID
   * @param provider - Provider name (e.g., "TruTech")
   * @param correlationId - Correlation ID for tracing
   * @returns Patient creation event
   */
  createPatientCreationEvent(
    patient: Patient,
    doctorId: string,
    organizationID: string,
    tenantId: string,
    provider: string,
    correlationId: string,
    doctorName?: string,
  ): PatientCreationEvent {
    return {
      eventType: 'patient.creation.requested',
      eventId: `${provider}-${patient.id}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      correlationId,
      data: {
        patient: {
          id: patient.id,
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
          gender: patient.gender,
          dob: patient.dateOfBirth,
          mrn: patient.mrn,
        },
        doctorId,
        doctorName,
        organizationID,
        tenantId,
        provider,
        externalId: String(patient.id),
      },
      metadata: {
        source: 'sso-integration',
      },
    };
  }
}

let patientEventPublisherInstance: PatientEventPublisher | null = null;

export function getPatientEventPublisher(): PatientEventPublisher {
  if (!patientEventPublisherInstance) {
    patientEventPublisherInstance = new PatientEventPublisher();
  }
  return patientEventPublisherInstance;
}
