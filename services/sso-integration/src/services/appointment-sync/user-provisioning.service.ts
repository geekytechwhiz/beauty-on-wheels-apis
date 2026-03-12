import { createChildLogger } from '@api-hub/logger';
   
  import { Appointment, User } from '../../types'; 
import { SSORequestContext } from '../../types/common/context.types';
import { makePatientCreationPayload } from '../../mappers/patient.mapper';
import { getSSOUserServiceClient, SSOUserServiceClient } from '../../clients/user-service.client';
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
    const logger = createChildLogger(this.logger, {
      correlationId: context.correlationId,
      doctorId: appointment.doctor.id,
    });

    const externalId = String(appointment.doctor.id);

    

    logger.info({
      event: 'doctor_not_found_creating',
      doctorId: appointment.doctor.id,
    });
    const doctorRequestPayload = makeDoctorCreationPayload(appointment, context);

    const createdUser = await this.ssoUserServiceClient.createDoctorWithRetry(
      doctorRequestPayload,
      context,
    );

    logger.info({
      event: 'createDoctorWithRetry',
      userId: createdUser.id,
    });

    return createdUser;
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
        provider: 'TruTech',
        externalId: externalUserId,
        tenantId: context.tenantId,
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