  import { createLogger, createChildLogger } from '@api-hub/logger';  
import { DoctorCreationPayload } from '../types/user-creation.types';
import { getSSOConfig } from '../config/sso-config';
import { processPhoneNumber } from '../utils/phone-processor'; 
import { CreateUserPayload, TruTechVerifyContext } from '../types/appointment.types';
import { SSOError } from '../types/errors/sso-error';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

/**
 * Maps TruTech doctor data to our system's doctor creation payload.
 * This is a generic mapper that can be extended for other providers in the future.
 */
export class UserCreateMapper {
  private readonly logger = createChildLogger(baseLogger, { component: 'DoctorMapperHelper' });

  /**
   * Maps TruTech verified payload and appointment doctor data to our system format.
   * 
   * @param verifiedPayload - Verified payload from TruTech token verification
   * @param correlationId - Correlation ID for logging
   * @returns Doctor creation payload for user service
   */
  mapTruTechDoctorToOurSystem(
    verifiedPayload: TruTechVerifyContext,
    correlationId?: string,
    subDomain?: string,
  ): DoctorCreationPayload {
    const logger = createChildLogger(this.logger, { correlationId });
    const config = getSSOConfig();
    const externalId = String(verifiedPayload.drid);
    logger.info({
      event: 'doctor_mapping_start',
      doctorId: verifiedPayload.drid,
      hasAppointmentDoctor: '',
    });

    // Use appointment doctor data if available, otherwise use verified payload
    const doctorName = verifiedPayload.name || '';
    const doctorEmail = verifiedPayload.email;
    const doctorPhone = verifiedPayload.doctor_phone;
    const department = verifiedPayload.department || '';

    // Validate required fields
    if (!doctorName || doctorName.trim() === '') {
      logger.error({
        event: 'doctor_mapping_error',
        reason: 'missing_doctor_name',
      });
      throw SSOError.invalidRequest('Doctor name is required');
    }

    if (!doctorEmail || doctorEmail.trim() === '') {
      logger.error({
        event: 'doctor_mapping_error',
        reason: 'missing_doctor_email',
      });
      throw SSOError.invalidRequest('Doctor email is required for STAFF');
    }

    // Process phone number
    const phoneProcessed = processPhoneNumber(doctorPhone, config.patient.phoneCode);

    // Build working hours from config (default: all days 07:00-21:00)
    const defaultWorkingHours = {
      available: config.doctor.workingHours.available,
      availableHours: config.doctor.workingHours.availableHours,
    };

    const workingHours = {
      monday: defaultWorkingHours,
      tuesday: defaultWorkingHours,
      wednesday: defaultWorkingHours,
      thursday: defaultWorkingHours,
      friday: defaultWorkingHours,
      saturday: defaultWorkingHours,
      sunday: defaultWorkingHours,
    };

    const payload: DoctorCreationPayload | CreateUserPayload = {
      userInfo: {
        name: doctorName.trim(),
        namePrefix: config.doctor.namePrefix,
        contact: {
          email: doctorEmail.trim(),
          ...(phoneProcessed.phoneNumber && {
            phone: phoneProcessed.phoneNumber,
            phoneCode: phoneProcessed.phoneCode,
          }),
        },
        ...(department && { department }),
        specialty: config.doctor.specialty,
        licenseNumber: config.doctor.licenseNumber,
        workingHours,
        slotDurationInMinutes: config.doctor.slotDurationInMinutes,
        bio: config.doctor.bio,
      },
      userRole: [config.doctorRoleId],
      userType: 'STAFF',
      organizationID: config.defaultOrganizationID,
      externalId: externalId,
      provider: 'TruTech', 
      subDomain: subDomain || verifiedPayload.tenant_id  ,
      role: config.doctorRoleId,
      source: 'TruTech',
      email: doctorEmail.trim(),
      phone: phoneProcessed.phoneNumber,
      firstName: doctorName.trim(),
      lastName: doctorName.trim(),
    } as DoctorCreationPayload;

    logger.info({
      event: 'doctor_mapping_success',
      doctorName: (payload as DoctorCreationPayload).userInfo.name,
      hasPhone: !!(payload as DoctorCreationPayload).userInfo.contact.phone,
    });

    return payload as DoctorCreationPayload;
  }

  
}

let userCreateMapperInstance: UserCreateMapper | null = null;

export function getCreateDoctorMapper(): UserCreateMapper {
  if (!userCreateMapperInstance) {
    userCreateMapperInstance = new UserCreateMapper();
  }
  return userCreateMapperInstance;
}
