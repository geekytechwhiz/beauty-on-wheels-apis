import { createChildLogger, type Logger } from '@api-hub/observability';

import { Appointment, User } from '../../types';
import { SSORequestContext } from '../../types/common/context.types';
import {
  getSSOUserServiceClient,
  SSOUserServiceClient,
} from '../../clients/user-service.client';
import { CognitoService } from '../cognito.service';
import {
  mapHmsDoctorToCreateDoctorModel,
  mapHmsAppointmentPatientToCreatePatientModel,
} from '../../mappers/user-creation.mapper';
import { CreatedUserInfo } from '../../types/user/user.types';
import { UserExistenceValidator } from '../../validators/user-existence.validator';
import { getOrganizationRoleIds } from '../organization-role.service';

function mapUserToCreatedUserInfo(
  user: User,
  fallbackEmail?: string | null,
): CreatedUserInfo {
  return {
    userId: user.id?.toString() ?? '',
    email: user.email ?? fallbackEmail ?? null,
    externalUserId: user.externalId?.toString() ?? '',
    organizationId: user.organizationId ?? '',
  };
}

export class UserProvisioningService {
  private readonly userExistenceValidator: UserExistenceValidator;
  constructor(
    private readonly ssoUserServiceClient: SSOUserServiceClient,
    private readonly logger: Logger,
  ) {
    this.ssoUserServiceClient = getSSOUserServiceClient();
    this.userExistenceValidator = new UserExistenceValidator(
      this.ssoUserServiceClient,
      new CognitoService(),
      this.logger,
    );
  }

  /**
   * Lookup doctor by external id only. Used by appointmentProcessor to decide
   * whether to enqueue to DoctorProvisionQueue (when null) or continue processing.
   */
  async getDoctorIfExists(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo | null> {
    const doctorExternalId = String(appointment.doctor.id);
    const existenceResult = await this.userExistenceValidator.checkUserExists(
      {
        externalId: doctorExternalId,
        email: appointment.doctor.email ?? null,
        phone: appointment.doctor.phone ?? null,
      },
      context,
    );

    if (existenceResult.userServiceUser) {
      return mapUserToCreatedUserInfo(
        existenceResult.userServiceUser,
        appointment.doctor.email ?? null,
      );
    }

    return null;
  }

  async getOrCreateDoctor(
    appointment: Appointment,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
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
    const existenceResult = await this.userExistenceValidator.checkUserExists(
      {
        externalId: doctorExternalId,
        email: doctorEmail,
        phone: appointment.doctor.phone ?? null,
      },
      context,
    );
    const existingUser = existenceResult.userServiceUser;
    const existingCognitoUser = existenceResult.cognitoUser;

    if (existingUser) {
      logger.info({
        event: 'doctor_found_existing',
        doctorExternalId,
        doctorEmail,
        doctorUserId: existingUser.id,
        ...existingUser,
      });

      if (!existingCognitoUser) {
        throw new Error('Doctor found in user service but not in cognito');
      }
      return mapUserToCreatedUserInfo(existingUser, doctorEmail);
    }

    // 2️⃣ Doctor not found → create (idempotent via externalUserId + user-service)
    logger.info({
      event: 'doctor_not_found_creating',
      doctorExternalId,
      doctorEmail,
    });

    const organizationId = context.integration.externalHospitalId;
    if (!organizationId) {
      throw new Error('organizationId is required in request context');
    }
    const roleIds = await getOrganizationRoleIds(organizationId, context);

    const doctorRequestPayload = mapHmsDoctorToCreateDoctorModel(
      appointment,
      context,
      roleIds,
    );

    try {
      const createdDoctor =
        await this.ssoUserServiceClient.createDoctorWithRetry(
          doctorRequestPayload,
          context,
        );

      logger.info({
        event: 'doctor_created_success',
        doctorExternalId,
        doctorEmail: createdDoctor.email ?? doctorEmail,
        doctorUserId: createdDoctor.userId,
        tenantId: context.tenantId,
      });

      // const doctorUser = await this.ssoUserServiceClient.findUserByExternalId(
      //   { externalId: doctorExternalId },
      //   context,
      // );

      // if (!doctorUser) {
      //   logger.error({
      //     event: 'doctor_created_but_not_found_on_lookup',
      //     doctorExternalId,
      //     doctorEmail: createdDoctor.email ?? doctorEmail,
      //     doctorUserId: createdDoctor.userId,
      //     tenantId: context.tenantId,
      //   });

      //   throw new Error(
      //     'Doctor was created but could not be retrieved from user service',
      //   );
      // }

      return createdDoctor;
    } catch (error: unknown) {
      // 3️⃣ Handle race condition (another process created the user)
      const conflictStatus = (error as { response?: { status?: number } })
        ?.response?.status;

      if (conflictStatus === 409) {
        logger.warn({
          event: 'doctor_creation_conflict_fetching_existing',
          doctorExternalId,
          doctorEmail,
        });

        const existingAfterConflict = (
          await this.userExistenceValidator.checkUserExists(
            {
              externalId: doctorExternalId,
              email: doctorEmail,
              phone: appointment.doctor.phone ?? null,
            },
            context,
          )
        ).userServiceUser;

        if (existingAfterConflict) {
          logger.info({
            event: 'doctor_conflict_resolved_existing_returned',
            doctorExternalId,
            doctorEmail,
            doctorUserId: existingAfterConflict.id,
          });
          return mapUserToCreatedUserInfo(existingAfterConflict, doctorEmail);
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

    const existenceResult = await this.userExistenceValidator.checkUserExists(
      {
        externalId: externalUserId,
        email: appointment.patient.email ?? null,
        phone: appointment.patient.phone ?? null,
      },
      context,
    );
    const existingUser = existenceResult.userServiceUser;

    if (existingUser) {
      logger.info({
        event: 'patient_found',
        userId: existingUser?.id ?? '',
      });

      return existingUser;
    }

    if (existenceResult.cognitoUser) {
      logger.info({
        event: 'patient_found_in_cognito_creating_user_service_record',
        patientExternalId: externalUserId,
        userId: existenceResult.cognitoUser.userId,
      });
    }

    logger.info({
      event: 'patient_not_found_creating',
      patientExternalId: externalUserId,
    });
    const organizationId = context.integration.externalHospitalId;
    if (!organizationId) {
      throw new Error('organizationId is required in request context');
    }
    const roleIds = await getOrganizationRoleIds(organizationId, context);
    const patientRequestPayload = mapHmsAppointmentPatientToCreatePatientModel(
      appointment,
      context,
      roleIds,
    );
    const createdUser = await this.ssoUserServiceClient.createPatient(
      patientRequestPayload,
      context,
    );

    logger.info({
      event: 'patient_created',
      userId: createdUser.userId,
    });

    return {
      invitedUser: createdUser.userId,
      id: createdUser.userId,
      externalId: createdUser.externalUserId,
      provider: context.integration?.providerId ?? '',
      tenantId: context.integration?.subdomain ?? context.tenantId,
      email: createdUser.email ?? undefined,
      status: 'ACTIVE',
      organizationId: createdUser.organizationId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
