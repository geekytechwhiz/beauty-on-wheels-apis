import { Appointment, SSORequestContext } from '../types';
 
import { makePrefixFromGender, loadTenantDetails } from '../utils/helper';
import { PatientCreationPayload } from '../types/user-creation.type';
import { PHONE_CODE } from '../utils/constants';

export function makePatientCreationPayload(
  appointment: Appointment, 
  context: SSORequestContext,
): PatientCreationPayload {
  const patient = appointment.patient;
  const now = Date.now();
  const tenant = loadTenantDetails(context.integration.subdomain);
  return {
    userInfo: {
      name: patient.name ?? '',
      namePrefix: makePrefixFromGender(patient.gender),
      contact: {
        email: patient.email ?? '',
        phone: patient.phone ?? '',
        phoneCode: PHONE_CODE.SOUTH_AFRICA,
      },

      emergencyContact: {},
      friendNFamily: {},
      medicalHistory: {
        allergies: [],
        chronicDiseases: [],
        symptoms: [],
      },
    },

    userRole: [tenant.patientRoleId],

    userType: 'USER',

    invite: patient.phone ? 'phone' : 'email',

    organizationID: tenant.organizationId,
    createdDate: now,
    modifiedDate: now,
    externalIdentity: { 
      externalUserId: patient.id.toString(),
      externalHospitalId: context.integration.subdomain,
      subdomain: context.integration.subdomain,
      sourceSystem: context.sourceSystem,
      provider: context.integration?.providerId ?? tenant.provider,
    },
  
  };
}
