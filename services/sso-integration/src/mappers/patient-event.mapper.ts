import { loadTenantDetails } from "../utils/helper";
import { SourceSystem } from "../types/common/context.types";
import { PatientCreationEvent } from "../types/events";
import { PatientCreationPayload } from "../types/user-creation.type";
import { PHONE_CODE } from "../utils/constants";
import { RoleIds } from "./user-creation.mapper";

export function mapPatientEventToCreateUserPayload(
  event: PatientCreationevent: any,
  roleIds: RoleIds,
): PatientCreationPayload {
  const { patient, organizationID, provider, externalId } = event.data;
  const subdomain = (event.data as { subdomain?: string }).subdomain ?? '';
  const tenant = loadTenantDetails(subdomain);
  if (!roleIds.patientRoleId || !tenant.provider) {
    throw new Error('Patient role and provider are required');
  }
  const name = (patient.name ?? "").toString().trim();
  const gender = patient.gender ?? "";
  const dob = patient.dob ?? "";
  const email = (patient.email ?? "") || "";
  const phone = (patient.phone ?? "") || ""; 
  const now = Date.now();
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
      name : name ?? "",
      namePrefix: patient.namePrefix ?? "",
      gender : gender ?? "",
      dateOfBirth: dob ?? "",
      contact: {
        email: email ?? "",
        phone: phone ?? "",
        phoneCode:   PHONE_CODE.SOUTH_AFRICA,
      },
      emergencyContact,
      medicalHistory: {
        allergies: medicalHistory.allergies ?? [],
        chronicDiseases: medicalHistory.chronicDiseases ?? [],
        symptoms: medicalHistory.symptoms ?? [],
      },
      friendNFamily: { },
    },
    userRole: [roleIds.patientRoleId],
    userType: "USER",
    organizationID: organizationID ?? tenant.organizationId,
    externalIdentity: {
      externalUserId: String(externalId || patient.id),
      externalHospitalId: organizationID ?? tenant.organizationId,
      subdomain: tenant.subdomain,
      sourceSystem: SourceSystem.HMS,
      provider: provider || tenant.provider,
    },
    createdDate: now,
    modifiedDate: now,
  };
}