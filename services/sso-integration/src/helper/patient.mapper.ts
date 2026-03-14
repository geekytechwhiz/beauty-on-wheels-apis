import { createLogger, createChildLogger } from '@api-hub/logger';
import { Patient } from '../types/domain/patient.types';
import { SSOError } from '../types/errors/sso-error';
import { PatientCreationPayload } from '../types/user-creation.type';
import { getSSOConfig } from '../config/sso-config';
import { processPhoneNumber } from '../utils/phone-processor';
import { loadTenantDetails } from '../utils/helper';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

/**
 * Maps TruTech patient data to our system's patient creation payload.
 * This is a generic mapper that can be extended for other providers in the future.
 */
export class PatientMapperHelper {
  private readonly logger = createChildLogger(baseLogger, { component: 'PatientMapperHelper' });

  /**
   * Maps TruTech patient data to our system format.
   * 
   * @param patient - Patient data from TruTech appointment
   * @param doctorId - Our system's doctor user ID (for assignment)
   * @param doctorName - Doctor name (for assignment)
   * @param correlationId - Correlation ID for logging
   * @returns Patient creation payload for user service
   */
  mapTruTechPatientToOurSystem(
    patient: Patient,
    doctorId: string,
    doctorName: string,
    correlationId?: string,
    subDomain?: string,
  ): PatientCreationPayload {
    const logger = createChildLogger(this.logger, { correlationId });
    const config = getSSOConfig();
    const tenant = loadTenantDetails(subDomain ?? '');

    logger.info({
      event: 'patient_mapping_start',
      patientId: patient.id,
      patientName: patient.name,
    });

    // Validate required fields: either email OR phone must be present
    const hasEmail = patient.email && patient.email.trim() !== '';
    const hasPhone = patient.phone && patient.phone.trim() !== '';

    if (!hasEmail && !hasPhone) {
      logger.error({
        event: 'patient_mapping_error',
        reason: 'missing_email_and_phone',
        patientId: patient.id,
      });
      throw SSOError.invalidRequest(
        'Patient must have either email or phone number',
      );
    }

    // Process phone number if provided
    const phoneProcessed = processPhoneNumber(patient.phone, config.patient.phoneCode);

    // Format date of birth: convert from ISO format (YYYY-MM-DD) to DD-MM-YYYY
    let formattedDateOfBirth: string | undefined;
    if (patient.dateOfBirth) {
      try {
        // Try parsing ISO format first
        const date = new Date(patient.dateOfBirth);
        if (!isNaN(date.getTime())) {
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const year = date.getFullYear();
          formattedDateOfBirth = `${day}-${month}-${year}`;
        } else {
          // If not ISO, assume it's already in DD-MM-YYYY format
          formattedDateOfBirth = patient.dateOfBirth;
        }
      } catch (error) {
        logger.warn({
          event: 'patient_mapping_date_parse_warning',
          patientId: patient.id,
          dateOfBirth: patient.dateOfBirth,
          err: error,
        });
        // Use as-is if parsing fails
        formattedDateOfBirth = patient.dateOfBirth;
      }
    }

    // Set name prefix based on gender
    let namePrefix = 'Mr';
    if (patient.gender) {
      const genderLower = patient.gender.toLowerCase();
      if (genderLower === 'female' || genderLower === 'f') {
        namePrefix = 'Ms';
      } else if (genderLower === 'male' || genderLower === 'm') {
        namePrefix = 'Mr';
      }
    }

    const payload: PatientCreationPayload = {
      userInfo: {
        name: patient.name.trim(),
        namePrefix,
        contact: {
          ...(hasEmail && { email: patient.email!.trim() }),
          ...(phoneProcessed.phoneNumber && {
            phone: phoneProcessed.phoneNumber,
            phoneCode: phoneProcessed.phoneCode,
          }),
        },
        ...(formattedDateOfBirth && { dateOfBirth: formattedDateOfBirth }),
        ...(patient.gender && { gender: patient.gender }),
        assignDoctor: {
          name: doctorName,
          doctorId,
        },
        emergencyContact: config.patient.emergencyContact,
        friendNFamily: config.patient.friendNFamily,
        medicalHistory: config.patient.medicalHistory,
      },
      userRole: [tenant.patientRoleId],
      userType: 'USER',
      invite: 'phone',
      organizationID: tenant.organizationId,
    };

    logger.info({
      event: 'patient_mapping_success',
      patientName: payload.userInfo.name,
      hasEmail: !!payload.userInfo.contact.email,
      hasPhone: !!payload.userInfo.contact.phone,
    });

    return payload;
  }
}

let patientMapperHelperInstance: PatientMapperHelper | null = null;

export function getPatientMapperHelper(): PatientMapperHelper {
  if (!patientMapperHelperInstance) {
    patientMapperHelperInstance = new PatientMapperHelper();
  }
  return patientMapperHelperInstance;
}
