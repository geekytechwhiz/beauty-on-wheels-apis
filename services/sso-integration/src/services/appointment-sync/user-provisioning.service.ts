import { createChildLogger } from '@api-hub/logger';

import { Appointment, User } from '../../types';
import { SSORequestContext } from '../../types/common/context.types';
import { makePatientCreationPayload } from '../../mappers/patient.mapper';
import {
  getSSOUserServiceClient,
  SSOUserServiceClient,
} from '../../clients/user-service.client';
import { makeDoctorCreationPayload } from '../../mappers/user-create.mapper';

export class UserProvisioningService {
  constructor(
    private readonly ssoUserServiceClient: SSOUserServiceClient,
    private readonly logger: any,
  ) {
    this.ssoUserServiceClient = getSSOUserServiceClient();
  }

  async getOrCreateDoctor(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<User> {
    const doctorExternalId = String(appointment.doctor.id);
    const doctorEmail = appointment.doctor.email ?? null;

    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      doctorExternalId,
      doctorEmail,
    });

    logger.info({
      event: 'get_or_create_doctor_start',
      doctorExternalId,
      doctorEmail,
    });

    // 1️⃣ Check if doctor already exists (idempotent read)
    const existingUser = await this.ssoUserServiceClient.findUserByExternalId(
      { externalId: doctorExternalId },
      context,
    );

    if (existingUser) {
      logger.info({
        event: 'doctor_found_existing',
        doctorExternalId,
        doctorEmail,
        doctorUserId: existingUser.id,
      });

      return existingUser;
    }

    // 2️⃣ Doctor not found → create (idempotent via externalUserId + user-service)
    logger.info({
      event: 'doctor_not_found_creating',
      doctorExternalId,
      doctorEmail,
    });

    const doctorRequestPayload = makeDoctorCreationPayload(
      appointment,
      context,
    );

    try {
      const createdUser = await this.ssoUserServiceClient.createDoctorWithRetry(
        doctorRequestPayload,
        context,
      );

      logger.info({
        event: 'doctor_created_success',
        doctorExternalId,
        doctorEmail,
        doctorUserId: createdUser.id,
      });

      return createdUser;
    } catch (error: any) {
      // 3️⃣ Handle race condition (another process created the user)
      if (error?.response?.status === 409) {
        logger.warn({
          event: 'doctor_creation_conflict_fetching_existing',
          doctorExternalId,
          doctorEmail,
        });

        const existingAfterConflict =
          await this.ssoUserServiceClient.findUserByExternalId(
            { externalId: doctorExternalId },
            context,
          );

        if (existingAfterConflict) {
          logger.info({
            event: 'doctor_conflict_resolved_existing_returned',
            doctorExternalId,
            doctorEmail,
            doctorUserId: existingAfterConflict.id,
          });
          return existingAfterConflict;
        }
      }

      throw error;
    }
  }

  async getOrCreatePatient(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<User> {
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      patientExternalId: appointment.patient.id,
    });

    const externalUserId = String(appointment.patient.id); 

    const existingUser = await this.ssoUserServiceClient.findUserByExternalId(
      { 
        externalId: externalUserId, 
      },
      context,
    );

    if (existingUser) {
      logger.info({
        event: 'patient_found',
        userId: existingUser?.id ?? '',
      });

      return existingUser;
    }

    logger.info({
      event: 'patient_not_found_creating',
      patientExternalId: externalUserId,
    });
    const patientRequestPayload = makePatientCreationPayload(appointment, context);
    const createdUser = await this.ssoUserServiceClient.createPatient(
      patientRequestPayload,
      context,
    );

    logger.info({
      event: 'patient_created',
      userId: createdUser.id,
    });

    return createdUser;
  }
}