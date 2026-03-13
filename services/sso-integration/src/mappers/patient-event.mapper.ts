import { PATIENT_ROLE_ID, PHONE_CODE, PROVIDER, SUBDOMAIN } from "../utils/constants";
import { PatientCreationEvent } from "../types/events";
import { PatientCreationPayload } from "../types/user-creation.type";
import { SourceSystem } from "../types/common/context.types";

export function mapPatientEventToCreateUserPayload(
  event: PatientCreationEvent
): PatientCreationPayload {
  const { patient, organizationID, provider, externalId } = event.data;
  const now = Date.now();

  const name = (patient.name ?? "").toString().trim();
  const gender = patient.gender ?? "";
  const dob = patient.dob ?? "";
  const email = (patient.email ?? "") || "";
  const phone = (patient.phone ?? "") || "";
  const phoneCode = patient.phoneCode ?? PHONE_CODE.SOUTH_AFRICA;

  const medicalHistory =
    (patient.medicalHistory as {
      allergies?: unknown[];
      chronicDiseases?: unknown[];
      symptoms?: unknown[];
    }) ?? {
      allergies: [] as unknown[],
      chronicDiseases: [] as unknown[],
      symptoms: [] as unknown[],
    };

  const emergencyContact = patient.emergencyContact ?? {};

  return {
    invite: phone ? "phone" : "email",
    userInfo: {
      name,
      namePrefix: patient.namePrefix ?? "",
      gender,
      dateOfBirth: dob,
      contact: {
        email,
        phone,
        phoneCode,
      },
      emergencyContact,
      medicalHistory: {
        allergies: medicalHistory.allergies ?? [],
        chronicDiseases: medicalHistory.chronicDiseases ?? [],
        symptoms: medicalHistory.symptoms ?? [],
      },
      friendNFamily: {
        name: "",
        relation: "",
        phone: "",
        phoneCode: PHONE_CODE.SOUTH_AFRICA,
        email: "",
      },
    },
    userRole: [PATIENT_ROLE_ID],
    userType: "USER",
    organizationID,
    externalIdentity: {
      externalUserId: String(externalId || patient.id),
      // Use organizationID as the external hospital/tenant identifier where applicable.
      externalHospitalId: organizationID,
      subdomain: SUBDOMAIN.TRU_TECH,
      sourceSystem: SourceSystem.HMS,
      provider: provider || PROVIDER.TRU_TECH,
    },
    createdDate: now,
    modifiedDate: now,
  };
}