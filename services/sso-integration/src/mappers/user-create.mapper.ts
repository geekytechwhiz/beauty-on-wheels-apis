import { createChildLogger, createLogger } from '@api-hub/logger'
import { getSSOConfig } from '../config/sso-config'
import { Appointment, SourceSystem, SSORequestContext } from '../types'
import { SSOError } from '../types/errors/sso-error'
import { DoctorCreationPayload } from '../types/user-creation.types'
import { processPhoneNumber } from '../utils/phone-processor'
import { DOCTOR_ROLE_ID } from '../utils/constants'

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true
})
export function makeDoctorCreationPayload(
  appointment: Appointment,
  context: SSORequestContext
): DoctorCreationPayload {

  const logger =
    createChildLogger(baseLogger, { correlationId: context.correlationId })

  const config = getSSOConfig()

  logger.info({
    event: 'doctor_mapping_start',
    doctorId: appointment.doctor.id
  })

  const doctorName = appointment.doctor.name
  const doctorEmail = appointment.doctor.email
  const doctorPhone = appointment.doctor.phone
  const department = appointment.doctor.department

  if (!doctorName) {
    throw SSOError.invalidRequest('Doctor name is required')
  }

  if (!doctorEmail) {
    throw SSOError.invalidRequest('Doctor email is required for STAFF')
  }

  const phoneProcessed =
    processPhoneNumber(doctorPhone, config.patient.phoneCode)

  const defaultWorkingHours = {
    available: config.doctor.workingHours.available,
    availableHours: config.doctor.workingHours.availableHours
  }

  const workingHours = {
    monday: defaultWorkingHours,
    tuesday: defaultWorkingHours,
    wednesday: defaultWorkingHours,
    thursday: defaultWorkingHours,
    friday: defaultWorkingHours,
    saturday: defaultWorkingHours,
    sunday: defaultWorkingHours
  }

  const payload: DoctorCreationPayload = {

    userInfo: {

      name: doctorName.trim(),

      namePrefix: config.doctor.namePrefix,

      contact: {
        email: doctorEmail.trim(),
        ...(phoneProcessed.phoneNumber && {
          phone: phoneProcessed.phoneNumber,
          phoneCode: phoneProcessed.phoneCode
        })
      },

      ...(department && { department }),

      specialty: config.doctor.specialty,

      licenseNumber: config.doctor.licenseNumber,

      workingHours,

      slotDurationInMinutes: config.doctor.slotDurationInMinutes,

      bio: config.doctor.bio
    },

    userRole: [DOCTOR_ROLE_ID],
    invite: "email",
    userType: 'STAFF',

    organizationID: config.defaultOrganizationID,

    externalIdentity: {
      externalUserId: appointment.doctor.id.toString(),
      externalHospitalId: context.integration?.externalHospitalId,
      subdomain: context.integration?.subdomain,
      sourceSystem: SourceSystem.HMS,
      provider: context.integration?.providerId ?? 'TruTech'
    },
  
    role: DOCTOR_ROLE_ID,

    source: 'HMS',

    email: doctorEmail.trim(),

    phone: phoneProcessed.phoneNumber,

    firstName: doctorName.trim(),

    lastName: doctorName.trim(),  
  }

  logger.info({
    event: 'doctor_mapping_success',
    doctorName: payload.userInfo.name,
    hasPhone: !!payload.userInfo.contact.phone
  })

  return payload
}