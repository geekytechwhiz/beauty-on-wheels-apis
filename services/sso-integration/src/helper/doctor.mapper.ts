import { createLogger, createChildLogger } from '@api-hub/logger';
import { TruTechVerifiedPayload, TruTechVerifyContext } from '../types/appointment.types';
import { Doctor } from '../types/domain/doctor.types';
import { SSOError } from '../types/errors/sso-error';
import { DoctorCreationPayload } from '../types/user-creation.type';
import { getSSOConfig } from '../config/sso-config';
import { processPhoneNumber } from '../utils/phone-processor';
import { getOrganizationIdBySubdomain } from '../utils/helper';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

/**
 * Maps TruTech doctor data to our system's doctor creation payload.
 * This is a generic mapper that can be extended for other providers in the future.
 */
export class DoctorMapperHelper {
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

    const payload: DoctorCreationPayload = {
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
      organizationID: getOrganizationIdBySubdomain(subDomain || verifiedPayload.tenant_id),
      externalId: externalId,
      provider: 'TruTech', 
      subDomain: subDomain || verifiedPayload.tenant_id 
    };

    logger.info({
      event: 'doctor_mapping_success',
      doctorName: payload.userInfo.name,
      hasPhone: !!payload.userInfo.contact.phone,
    });

    return payload;
  }
}

let doctorMapperHelperInstance: DoctorMapperHelper | null = null;

export function getDoctorMapperHelper(): DoctorMapperHelper {
  if (!doctorMapperHelperInstance) {
    doctorMapperHelperInstance = new DoctorMapperHelper();
  }
  return doctorMapperHelperInstance;
}
