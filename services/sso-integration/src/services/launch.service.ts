import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { getTruTechAdapter } from '../adapters/TruTech.adapter';
import { getUserServiceClient } from './user.client';
import { getDoctorMapperHelper } from '../utils/helper/doctor.mapper.helper';
import { getPatientEventPublisher } from './patient-event-publisher.service';
import { getSSOConfig } from '../config/sso-config';
import { getServiceTokenService, ServiceTokenResult } from './service-token.service';
import { SSOError, TruTechVerifiedPayload, Appointment, User } from '../types';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export interface LaunchProcessResult {
  doctor: User;
  appointments: Appointment[];
  patientEventsPublished: number;
  serviceToken: ServiceTokenResult;
}

/**
 * High-level SSO launch flow (existing behavior):
 *
 * /sso/launch Lambda handler (`handlers/sso/launch.ts`)
 *   → `SSOController.handleLaunch` (`controllers/sso.controller.ts`)
 *   → `LaunchService.processLaunch` (this file)
 *
 * `processLaunch` orchestrates:
 *   1) Verify HMS launch token with TruTech via
 *      `TruTechAdapter.verifyLaunchToken` (`adapters/TruTech.adapter.ts`).
 *   2) Fetch today's appointments via `TruTechAdapter.getTodaysAppointments`.
 *   3) Ensure the doctor exists in our User Service via `ensureDoctorExists`,
 *      which calls `UserServiceClient.createDoctor` (`services/user.client.ts`)
 *      when the doctor is missing. The User Service creates the internal user
 *      and the corresponding Cognito user.
 *   4) (Planned / asynchronous) publish patient creation events using
 *      `PatientEventPublisher` (`services/patient-event-publisher.service.ts`).
 *      Those events are consumed by the `patient-creation-event-consumer`
 *      Lambda, which calls `UserServiceClient.createPatient` to create patient
 *      users (and their Cognito users) in the background.
 *
 * On successful launch, `SSOController.handleLaunch` returns an API Gateway
 * response containing the doctor summary and the list of appointments.
 */
export class LaunchService {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'LaunchService',
  });
  private readonly truTechAdapter = getTruTechAdapter();
  private readonly userServiceClient = getUserServiceClient();
  private readonly doctorMapper = getDoctorMapperHelper();
  private readonly patientEventPublisher = getPatientEventPublisher();
  private readonly serviceTokenService = getServiceTokenService();

  /**
   * Verifies launch token with TruTech.
   */
  async verifyLaunchToken(
    launchToken: string,
    correlationId: string,
  ): Promise<TruTechVerifiedPayload> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'launch_verify_start',
    });

    try {
      const payload = await this.truTechAdapter.verifyLaunchToken(
        launchToken,
        correlationId,
      );

      logger.info({
        event: 'launch_verify_success',
        doctorId: payload.doctorId,
        tenantId: payload.tenantId,
      });

      return payload;
    } catch (error) {
      if (error instanceof SSOError) {
        logger.warn({
          event: 'launch_verify_error',
          code: error.code,
          statusCode: error.statusCode,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'launch_verify_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to verify launch token',
        error as Error,
      );
    }
  }

  /**
   * Processes the full launch flow:
   * 1. Verify launch token
   * 2. Fetch today's appointments
   * 3. Check/create doctor (synchronous - blocking)
   * 4. Publish patient creation events (asynchronous - fire and forget)
   *
   * @param launchToken - Launch token from TruTech
   * @param correlationId - Correlation ID for tracing
   * @returns Launch process result with doctor and appointments
   */
  async processLaunch(
    launchToken: string,
    correlationId: string,
  ): Promise<LaunchProcessResult> {
    const logger = createChildLogger(this.logger, { correlationId });

    logger.info({
      event: 'launch_process_start',
    });

    try {
      // Step 1: Verify launch token
      const verifiedPayload = await this.verifyLaunchToken(
        launchToken,
        correlationId,
      );
      console.log("VERIFIED PAYLOAD ",verifiedPayload)
      // Step 2: Fetch today's appointments
      const appointments = await this.truTechAdapter.getTodaysAppointments(
        verifiedPayload.doctorId,
        correlationId,
      );

      logger.info({
        event: 'launch_appointments_fetched',
        appointmentCount: appointments.length,
      });
      console.log("APPOINTMENTS ",appointments)
      // Step 3: Check if doctor exists, create if not (SYNCHRONOUS - blocking)
      const doctorUser = await this.ensureDoctorExists(
        verifiedPayload,
        appointments[0]?.doctor,
        correlationId,
      );
      console.log("DOCTOR USER : ", doctorUser);
      // Step 4: Publish patient creation events (ASYNCHRONOUS - fire and forget)
      // const patientEventsPublished = await this.publishPatientCreationEvents(
      //   appointments,
      //   doctor,
      //   doctor.id,
      //   verifiedPayload.tenantId,
      //   correlationId,
      // );

      // logger.info({
      //   event: 'launch_process_success',
      //   doctorId: doctor.id,
      //   appointmentCount: appointments.length,
      //   patientEventsPublished,
      // });

      // Step 5: Generate a short-lived service token containing user context
      const primaryAppointmentId =
        appointments[0]?.appointmentId ?? (appointments[0] as any)?.id;

      const serviceToken = this.serviceTokenService.generateToken(
        doctorUser.organizationID,
        {
          userId: doctorUser.id,
          role: 'DOCTOR',
          appointmentId: primaryAppointmentId,
        },
        correlationId,
      );

      return {
        doctor: {
          id: verifiedPayload.doctorId,
          externalId: verifiedPayload.doctorUid,
          provider: 'TruTech',
          tenantId: verifiedPayload.tenantId,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          doctorId: verifiedPayload.doctorId,
          partnerSource: 'HMS',
          launchSource: 'TruTech',
        },
        appointments,
        patientEventsPublished: 0,
        serviceToken,
      };
    } catch (error) {
      if (error instanceof SSOError) {
        logger.warn({
          event: 'launch_process_error',
          code: error.code,
          statusCode: error.statusCode,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'launch_process_unexpected_error',
        err: serializeError(error as Error),
      });

      throw SSOError.internalError('Failed to process launch', error as Error);
    }
  }

  /**
   * Ensures doctor exists in our system.
   * Checks by external_id, creates if not found.
   * This is SYNCHRONOUS and BLOCKING - must complete before proceeding.
   *
   * @param verifiedPayload - Verified payload from TruTech
   * @param appointmentDoctor - Optional doctor data from appointment
   * @param correlationId - Correlation ID for logging
   * @returns Doctor user (existing or newly created)
   */
  private async ensureDoctorExists(
    verifiedPayload: TruTechVerifiedPayload,
    appointmentDoctor?: import('../types').Doctor,
    correlationId?: string,
  ): Promise<User> {
    const logger = createChildLogger(this.logger, { correlationId });
    const provider = 'TruTech';
    const externalId = String(verifiedPayload.doctorUid);

    // logger.info({
    //   event: 'doctor_ensure_start',
    //   externalId,
    //   provider,
    //   tenantId: verifiedPayload.tenantId,
    // });

    // Check if doctor already exists
    // const existingDoctor = await this.userServiceClient.findByExternalId(
    //   {
    //     provider,
    //     externalId,
    //     tenantId: verifiedPayload.tenantId,
    //   },
    //   correlationId || '',
    // );

    // if (existingDoctor) {
    //   logger.info({
    //     event: 'doctor_ensure_exists',
    //     userId: existingDoctor.id,
    //     externalId,
    //   });
    //   return existingDoctor;
    // }

    // Doctor doesn't exist - create it
    logger.info({
      event: 'doctor_ensure_create',
      externalId,
    });

    const doctorPayload = this.doctorMapper.mapTruTechDoctorToOurSystem(
      verifiedPayload,
      appointmentDoctor,
      correlationId,
    );

    const newDoctor = await this.userServiceClient.createDoctor(
      doctorPayload,
      externalId,
      provider,
      verifiedPayload.tenantId,
      correlationId || '',
    );

    logger.info({
      event: 'doctor_ensure_created',
      userId: newDoctor.id,
      externalId,
    });

    return newDoctor;
  }

  /**
   * Publishes patient creation events for all unique patients in appointments.
   * This is ASYNCHRONOUS and NON-BLOCKING - fire and forget.
   *
   * @param appointments - Appointments from TruTech
   * @param doctor - Doctor user object (for getting doctor name)
   * @param doctorId - Our system's doctor user ID
   * @param tenantId - Tenant ID
   * @param correlationId - Correlation ID for logging
   * @returns Number of patient events published
   */
  private async publishPatientCreationEvents(
    appointments: Appointment[],
    doctor: User,
    doctorId: string,
    tenantId: string,
    correlationId: string,
  ): Promise<number> {
    const logger = createChildLogger(this.logger, { correlationId });

    // Extract unique patients from appointments
    const uniquePatients = new Map<number, Appointment['patient']>();
    for (const appointment of appointments) {
      if (appointment.patient && appointment.patient.id) {
        uniquePatients.set(appointment.patient.id, appointment.patient);
      }
    }

    if (uniquePatients.size === 0) {
      logger.info({
        event: 'patient_events_publish_skipped',
        reason: 'no_patients',
      });
      return 0;
    }

    logger.info({
      event: 'patient_events_publish_start',
      uniquePatientCount: uniquePatients.size,
    });

    // Get organizationID from config
    const config = getSSOConfig();
    const defaultOrganizationID = config.defaultOrganizationID;

    // Get doctor name for patient assignment (use doctor's name from User object or fallback)
    // The User object may have firstName/lastName or a name field
    const doctorName =
      (doctor as any).firstName || (doctor as any).lastName
        ? `${(doctor as any).firstName || ''} ${(doctor as any).lastName || ''}`.trim()
        : (doctor as any).name || undefined;

    // Create events for each unique patient
    const events = Array.from(uniquePatients.values()).map((patient) =>
      this.patientEventPublisher.createPatientCreationEvent(
        patient,
        doctorId,
        defaultOrganizationID,
        tenantId,
        'TruTech',
        correlationId,
        doctorName,
      ),
    );

    // Publish events in batch (fire and forget)
    await this.patientEventPublisher.publishPatientCreationEventsBatch(
      events,
      correlationId,
    );

    logger.info({
      event: 'patient_events_publish_complete',
      eventCount: events.length,
    });

    return events.length;
  }
}

let launchServiceInstance: LaunchService | null = null;

export function getLaunchService(): LaunchService {
  if (!launchServiceInstance) {
    launchServiceInstance = new LaunchService();
  }
  return launchServiceInstance;
}
