import { Appointment, SSORequestContext } from '../types';
import {
  PatientCreationPayload,
} from '../types/user-creation.types';
import { PATIENT_ROLE_ID, PHONE_CODE } from '../utils/constants';
import { getOrganizationIdBySubdomain, makePrefixFromGender } from '../utils/helper';

export function makePatientCreationPayload(
  appointment: Appointment, 
  context: SSORequestContext,
): PatientCreationPayload {
  const patient = appointment.patient; 
  const now = Date.now(); 
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

    userRole:  [PATIENT_ROLE_ID] ,

    userType: 'USER',

    invite: patient.phone ? 'phone' : 'email',

    organizationID: getOrganizationIdBySubdomain(context.integration.subdomain),
     
    externalIdentity: { 
      externalUserId: patient.id.toString(),
      externalHospitalId: context.integration.subdomain,
      subdomain: context.integration.subdomain,
      sourceSystem: context.sourceSystem,
      provider: context.integration.providerId,
    },
    createdDate: now,
    modifiedDate: now,
  };
}
