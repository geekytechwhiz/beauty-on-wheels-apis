import { PatientUserItem, UserItem } from "../models/UserListResponse";

function toOptionalAge(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function mapToPatientUser(item: Record<string, unknown>): PatientUserItem {
    const medicalHistory = (item.medicalHistory as Record<string, unknown>) ?? {};
    const age = toOptionalAge(item.age);
    return {
        ...item,
      city: String(item.city ?? ''),
      state: String(item.state ?? ''),
      country: String(item.country ?? ''),
      fullName: String(item.fullName ?? ''),
      emailAddress: String(item.emailAddress ?? ''),
      phoneNumber: String(item.phoneNumber ?? ''),
      lastAppointment: String(item.lastAppointment ?? ''),
      profilePic: String(item.profilePic ?? ''),
      reporterId: String(item.reporterId ?? item.reporterID ?? ''),
      doctor: String(item.doctor ?? ''),
      patientId: String(item.patientId ?? item.patientID ?? item.userID ?? item.userId ?? ''),
      accountType: String(item.accountType ?? ''),
      // isActive=true → status=true, isActive=false → status=false
      status: item.status !== undefined
        ? Boolean(item.status)
        : (item.isActive !== undefined ? Boolean(item.isActive) : true),
      createdDate: Number(item.createdDate ?? item.createdAt ?? 0),
      createdAt: Number(item.createdAt ?? item.createdDate ?? Date.now()),
      mrn: String(item.mrn ?? ''),
      gender: String(item.gender ?? ''),
      medicalHistory: {
        allergies: Array.isArray(medicalHistory.allergies) ? medicalHistory.allergies : [],
        symptoms: Array.isArray(medicalHistory.symptoms) ? medicalHistory.symptoms : [],
        chronicDiseases: Array.isArray(medicalHistory.chronicDiseases) ? medicalHistory.chronicDiseases : [],
      },
      dateOfBirth: String(item.dateOfBirth ?? ''),
      ...(age !== undefined ? { age } : {}),
      patientOrgId: String(item.patientOrgId ?? item.patientOrgID ?? item.organizationID ?? item.organizationId ?? ''),
    };
  }
  
  export  function mapToPastConsultationUser(item: Record<string, unknown>): PatientUserItem {
    return {
      ...mapToPatientUser(item),
      previouslyConsulted: Boolean(item.previouslyConsulted ?? false),
    };
  }
  
  export function mapToActiveConsultationUser(item: Record<string, unknown>): PatientUserItem {
    const base = mapToPatientUser(item);
    const activeService = item.activeService;
    return {
      ...base,
      activeService: Array.isArray(activeService) ? activeService : [],
    };
  }
  
  export function mapToPatientListItem(item: Record<string, unknown>): UserItem {
    const base = mapToUserItem(item);
    return {
      ...base,
      doctor: item.doctorName != null
        ? String(item.doctorName)
        : item.reporterName != null
          ? String(item.reporterName)
          : undefined,
    };
  }

  /** Lean mapper for ADMIN_DASHBOARD list — no full-item spread. */
  export function mapToAdminDashboardItem(item: Record<string, unknown>): UserItem {
    const status =
      item.status !== undefined
        ? Boolean(item.status)
        : item.isActive !== undefined
          ? Boolean(item.isActive)
          : true;

    const userID = String(item.userID ?? item.userId ?? '');

    return {
      userID,
      accountType: String(item.accountType ?? ''),
      patientId: userID,
      fullName: String(item.fullName ?? ''),
      firstName: String(item.firstName ?? ''),
      lastName: String(item.lastName ?? ''),
      emailAddress: String(item.emailAddress ?? ''),
      phoneNumber: String(item.phoneNumber ?? ''),
      phoneCode: String(item.phoneCode ?? ''),
      organizationID: String(item.organizationID ?? item.organizationId ?? ''),
      profilePic: String(item.profilePic ?? ''),
      mrn: String(item.mrn ?? ''),
      isActive: item.isActive !== undefined ? Boolean(item.isActive) : true,
      isRpmUser: Boolean(item.isRpmUser ?? false),
      userType: String(item.userType ?? ''),
      roleType: String(item.roleType ?? ''),
      roleID: String(item.roleID ?? item.roleId ?? ''),
      roleName: String(item.roleName ?? ''),
      definedRoleCode: String(item.definedRoleCode ?? ''),
      createdDate: Number(item.createdDate ?? item.createdAt ?? 0),
      modifiedDate: Number(item.modifiedDate ?? 0),
      status,
      createdAt: Number(item.createdAt ?? item.createdDate ?? Date.now()),
      specialty: item.specialty ? String(item.specialty) : undefined,
      department: item.department ? String(item.department) : undefined,
      reporterName: item.reporterName != null ? String(item.reporterName) : undefined,
      reporterProfilePic:
        item.reporterProfilePic != null ? String(item.reporterProfilePic) : undefined,
      doctorName: item.doctorName != null ? String(item.doctorName) : undefined,
      dateOfBirth: String(item.dateOfBirth ?? ''),
    };
  }

  export function mapToUserItem(item: Record<string, unknown>): UserItem {
    const age = toOptionalAge(item.age);
    return {
      ...item,
      accountType: String(item.accountType ?? ''),
      pk: item.pk != null ? String(item.pk) : undefined,
      sk: item.sk != null ? String(item.sk) : undefined,
      sk1: item.sk1 != null ? String(item.sk1) : undefined,
      sk2: item.sk2 != null ? String(item.sk2) : undefined,
      patientId: String(item.userID ?? item.userId ?? ''),
      fullName: String(item.fullName ?? ''),
      firstName: String(item.firstName ?? ''),
      lastName: String(item.lastName ?? ''),
      emailAddress: String(item.emailAddress ?? ''),
      phoneNumber: String(item.phoneNumber ?? ''),
      phoneCode: String(item.phoneCode ?? ''),
      organizationID: String(item.organizationID ?? item.organizationId ?? ''),
      profilePic: String(item.profilePic ?? ''),
      mrn: String(item.mrn ?? ''),
      dateOfBirth: String(item.dateOfBirth ?? ''),
      ...(age !== undefined ? { age } : {}),
      isActive: item.isActive !== undefined ? Boolean(item.isActive) : true,
      isRpmUser: Boolean(item.isRpmUser ?? false),
      userType: String(item.userType ?? ''),
      roleType: String(item.roleType ?? ''),
      roleID: String(item.roleID ?? item.roleId ?? ''),
      roleName: String(item.roleName ?? ''),
      definedRoleCode: String(item.definedRoleCode ?? ''),
      createdDate: Number(item.createdDate ?? item.createdAt ?? 0),
      modifiedDate: Number(item.modifiedDate ?? 0),
      // status mirrors isActive: if not stored in DB, derive from isActive
      status: item.status !== undefined ? Boolean(item.status) : (item.isActive !== undefined ? Boolean(item.isActive) : true),
      createdAt: Number(item.createdAt ?? item.createdDate ?? Date.now()),
      specialty: item.specialty ? String(item.specialty) : undefined,
      department: item.department ? String(item.department) : undefined,
      reporterName: item.reporterName != null ? String(item.reporterName) : undefined,
      reporterProfilePic: item.reporterProfilePic != null ? String(item.reporterProfilePic) : undefined,
      doctorName: item.doctorName != null ? String(item.doctorName) : undefined,
      deleteFlag: item.deleteFlag as null | undefined,
      postalCode: item.postalCode != null ? String(item.postalCode) : undefined,
      inviteDetails: item.inviteDetails
        ? (item.inviteDetails as UserItem['inviteDetails'])
        : undefined,
    };
  }