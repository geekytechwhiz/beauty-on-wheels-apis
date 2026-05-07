// ============================================================
// USER LIST RESPONSE TYPES — Frontend contract per use case
// ============================================================
//
// 1. Admin Dashboard (list staff + patients)     → data: { items }     → AdminDashboardResponse
// 2. Admin Chat (staff list to communicate)     → data: { items }     → AdminChatStaffListResponse
// 3. Patient Details (care team of patient)     → data: patient + reporter, careManager, dietician, healthCoach → PatientDetailsCareTeamResponse
// 4. Frontdesk booking (past consultations)     → data: { users }     → FrontdeskAppointmentPatientListResponse
// 5. Doctor Dashboard (all patients of doctor)  → data: { users }     → DoctorDashboardPatientListResponse
// 6. Lab Admin Dashboard (active appointments)  → data: { users }     → LabAdminDashboardResponse (user.activeService[])
// 7. Patient Details (doctors for lab/Rx)        → data: { items }     → PatientDetailsDoctorListResponse
// 8. Frontdesk chat (patients of organization)  → data: { items }     → FrontdeskChatPatientListResponse
//
// ============================================================
// API RESPONSE WRAPPER (frontend contract)
// ============================================================
// Every use-case response: success, statusCode, message, data, error: null, meta

import { UserListContext, V2UserListFilters, V2UserListPagination, V2UserListSort } from "../types/user-list-context.enum";

   
  export interface MedicalHistory {
    allergies: unknown[];
    symptoms: unknown[];
    chronicDiseases: unknown[];
  }
  
  // ─── Shared: Emergency Contact ────────────────────────────
  export interface EmergencyContact {
    name: string;
    phoneCode: string;
    phone: string;
    email: string;
    relation: string;
  }
  
  // ─── Shared: Staff / User Item (sk/pk keyed) ──────────────
  //     Used in: AdminDashboard, AdminChatStaffList,
  //              PatientDetailsDoctorList
  export interface StaffItem {
    sk: string;
    pk: string;
    sk1: string;
    sk2?: string;
    userID: string;
    userType: string;
    accountType: string;
    roleID: string;
    roleName: string;
    roleType: string;
    definedRoleCode: string;
    organizationID: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    emailAddress?: string;
    phoneNumber?: string;
    phoneCode: string;
    profilePic?: string;
    city: string;
    postalCode: string;
    mrn: string;
    isActive: boolean;
    isRpmUser: boolean;
    status: boolean;
    createdDate?: number;
    createdAt: number;
    modifiedDate?: number;
  }
  
  // ─── Shared: Patient User (users-array keyed) ─────────────
  //     Used in: DoctorDashboard, FrontdeskAppointmentPatients,
  //              LabAdminDashboard (as base)
  export interface PatientUser {
    patientId: string;
    fullName: string;
    emailAddress: string;
    phoneNumber: string;
    profilePic: string;
    gender: string;
    dateOfBirth: string;
    mrn: string;
    city: string;
    state: string;
    country: string;
    accountType: string;
    status: string;
    createdDate: number;
    lastAppointment: string;
    reporterId: string;
    doctor: string;
    patientOrgId: string;
    medicalHistory: MedicalHistory;
  }
  
  // ============================================================
  // 1. ADMIN DASHBOARD
  //    Use case: List staff members + patients
  // ============================================================
  
  export interface AdminDashboardStaffItem extends StaffItem {
    deleteFlag?: null;
    reporterName?: string;
    reporterProfilePic?: string;
    doctorName?: string;
  }
   
  // ============================================================
  // 2. ADMIN CHAT STAFF LIST
  //    Use case: Staff list for admin to communicate with
  // ============================================================
  
  export interface AdminChatStaffItem extends StaffItem {
    // All fields inherited from StaffItem
    // createdDate is required (not optional) here
    createdDate: number;
    city: string;
    phoneCode: string;
    postalCode: string;
  }
   
  
  // ============================================================
  // 3. PATIENT DETAILS — CARE TEAM
  //    Use case: Fetch care team members of the patient
  //    Key fields: reporter, careManager, dietician, healthCoach
  // ============================================================
  
  export interface CareTeamReporter {
    id: string;
    organizationID: string;
    fullName: string;
    emailAddress: string;
    phoneNumber: string;
    profilePic: string;
    specialty: string;
    department: string;
    position: string;
    city: string;
    state: string;
    country: string;
    accountType: string;
    status: string;
    createdDate: number;
  }
  
  export interface PatientDetailsCareTeamData {
    // Identity
    userID: string;
    pk: string;
    sk: string;
    mrn: string;
    userType: string;
    userCat: string[];
    accountType: string;
    organizationID: string;
  
    // Personal Info
    namePrefix: string;
    firstName: string;
    lastName: string;
    fullName: string;
    gender: string;
    dateOfBirth: string;
    profilePic: string;
    bio: string;
    experienceInYears: string;
  
    // Contact
    emailAddress: string;
    phoneCode: string;
    phoneNumber: string;
  
    // Address
    address: string;
    street: string;
    city: string;
    state: string;
    stateCode: string;
    country: string;
    countryCode: string;
    postalCode: string;
    zip: string;
  
    // Status
    isActive: boolean;
    isLoggedIn: boolean;
    isRpmUser: boolean;
  
    // Medical
    medicalHistory: MedicalHistory;
    insuranceDetails: Record<string, never>;
    emergencyContact: EmergencyContact;
  
    // Invite / Registration
    inviteCode: string;
    invitedBy: string;
    invitedID: string;
    srcRegisEntity: string;
  
    // Reporter (Primary Doctor)
    reporterId: string;
    reporterName: string;
    reporterEmail: string;
    reporterProfilePic: string;
  
    // Timestamps
    createdDate: number;
    modifiedDate: number;
    tokenUpdatedAt: number;
  
    // Care Team Members
    reporter: CareTeamReporter[];
    careManager: unknown[];
    dietician: unknown[];
    healthCoach: unknown[];
  }
 
  // ============================================================
  // 4. FRONTDESK APPOINTMENT — PATIENT LIST
  //    Use case: View patients with past consultations (same doctor)
  // ============================================================
  
  export interface FrontdeskAppointmentPatientItem extends PatientUser {
    previouslyConsulted: boolean;
  }
  
  export interface FrontdeskAppointmentPatientListData {
    users: FrontdeskAppointmentPatientItem[];
  }
   
  // ============================================================
  // 5. DOCTOR DASHBOARD — PATIENT LIST
  //    Use case: All patients of the doctor
  //    (includes non-primary: care queue, consultation, chat transfer)
  // ============================================================
  
  export type DoctorDashboardPatientItem = PatientUser
  
  export interface DoctorDashboardPatientListData {
    users: DoctorDashboardPatientItem[];
  }
   
  // ============================================================
  // 6. LAB ADMIN DASHBOARD — ACTIVE APPOINTMENTS
  //    Use case: Retrieve active appointments with full service detail
  // ============================================================
  
  export interface ActiveServiceCharges {
    price: number;
    currency: string;
    offerPrice: number;
  }
  
  export interface ActiveServiceDiscount {
    type: string;
    value: number;
  }
  
  export interface ActiveServiceLimit {
    durationMinutes: number;
    unit: number;
    extendable: boolean;
    used: number;
    remaining: number;
    frequency: string;
  }
  
  export interface ActiveServiceMetaOtherInfo {
    additionalInformation: string;
    ageGroup: string;
    gender: string;
    consultationMode: string;
  }
  
  export interface ActiveServiceMeta {
    conditions: string[];
    speciality: string;
    otherInformation: ActiveServiceMetaOtherInfo;
  }
  
  export interface ScheduledOwner {
    userId: string;
    name: string;
    email: string;
    userType: string;
    specialty: string;
    profileImage: string;
    isCaller: boolean;
  }
  
  export interface ScheduledStaff {
    userId: string;
    name: string;
    email: string;
    userType: string;
    specialty: string;
  }
  
  export interface ScheduledParticipant {
    userId: string;
    organizationID: string;
    name: string;
    email: string;
    phoneCode: string;
    phoneNumber: string;
    userType: string;
    specialty?: string;
  }
  
  export interface ScheduledMeta {
    userAddonId: string;
    paymentSchedule: string;
    userId: string;
  }
  
  export interface ScheduledEntry {
    scheduleId: string;
    bookingId: string;
    orgId: string;
    consultationType: string;
    duration: string;
    scheduleDate: string;
    scheduleSlot: string;
    startTime: string;
    endTime: string;
    scheduleTimeStamp: string;
    location: string;
    address: string;
    phoneCode: string;
    phoneNumber: string;
    scheduleQR: string;
    scheduleTicketLink: string;
    owner: ScheduledOwner;
    staff: ScheduledStaff;
    participantInfo: ScheduledParticipant[];
    meta: ScheduledMeta;
  }
  
  export interface LinkedOrgAddress {
    country: string;
    address: string;
    state: string;
    city: string;
    countryCode: string;
    postalCode: string;
  }
  
  export interface LinkedOrgAdminDetails {
    adminId: string;
    adminName: string;
    emailAddress: string;
  }
  
  export interface LinkedOrg {
    organizationName: string;
    organizationType: string;
    profilePic: string;
    address: LinkedOrgAddress;
    adminDetails: LinkedOrgAdminDetails;
  }
  
  export interface ActiveServiceAssignedStaff {
    emailAddress: string;
    profilePic: string;
    namePrefix: string;
  }
  
  export interface V2UserListServiceParams {
    organizationId: string;
    context: UserListContext;
    filters?: V2UserListFilters;
    pagination?: V2UserListPagination;
    sort?: V2UserListSort;
    requestId: string;
    authUserId?: string;
    authHeader?: string;
  }
  
  export interface UserItem {
    pk?: string;
    sk?: string;
    sk1?: string;
    sk2?: string;
    patientId: string;
    fullName: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber: string;
    phoneCode: string;
    organizationID: string;
    profilePic: string;
    mrn: string;
    isActive: boolean;
    isRpmUser: boolean;
    userType: string;
    roleType: string;
    roleID: string;
    roleName: string;
    definedRoleCode: string;
    createdDate: number;
    modifiedDate: number;
    status: boolean;
    createdAt: number;
    specialty?: string;
    department?: string;
    reporterName?: string;
    reporterProfilePic?: string;
    doctorName?: string;
    doctor?: string;
    deleteFlag?: null;
    postalCode?: string;
    inviteDetails?: {
      email: boolean;
      emailUpdatedAt: string;
      sms: boolean;
      smsUpdatedAt: string;
    };
    [key: string]: unknown;
  }
  
  export interface PatientUserItem {
    city: string;
    state: string;
    country: string;
    fullName: string;
    emailAddress: string;
    phoneNumber: string;
    lastAppointment: string;
    profilePic: string;
    reporterId: string;
    doctor: string;
    patientId: string;
    accountType: string;
    status: boolean;
    createdDate: number;
    createdAt: number;
    mrn: string;
    gender: string;
    medicalHistory: { allergies: unknown[]; symptoms: unknown[]; chronicDiseases: unknown[] };
    dateOfBirth: string;
    patientOrgId: string;
    previouslyConsulted?: boolean;
    activeService?: unknown[];
  } 
  export interface ActiveServiceReferredBy {
    emailAddress: string;
    specialty: string;
    profilePic: string;
    namePrefix: string;
  }
  
  export interface ActiveService {
    userAddonId: string;
    orgAddonId: string;
    orderId: string;
    lastOrderId: null;
    paymentId: string;
    paymentStatus: string;
    entityId: string;
    organizationId: string;
    linkedAddonId: string;
    linkedOrgId: string;
    linkedOrgName: string;
    referredByOrgId: string;
    referredByUserId: string;
    referredByUserName: string;
    featureKey: string;
    featureCategory: string;
    addonCategoryTitle: string;
    addonCategoryType: string;
    addonServiceCategory: string;
    listingType: string;
    title: string;
    description: string;
    isActive: boolean;
    status: string;
    serviceStatus: string;
    scheduledStatus: string;
    scheduleBy: number;
    assignedStaffId: string;
    assignedStaffName: string;
    assignedStaffSpeciality: string;
    charges: ActiveServiceCharges;
    discount: ActiveServiceDiscount;
    limit: ActiveServiceLimit;
    meta: ActiveServiceMeta;
    orders: unknown[];
    scheduled: ScheduledEntry[];
    createdAt: number;
    modifiedAt: number;
    linkedOrg: LinkedOrg;
    referredOrg: LinkedOrg;
    assignedStaff: ActiveServiceAssignedStaff;
    referredBy: ActiveServiceReferredBy;
  }
  
  export interface LabAdminDashboardPatientItem extends PatientUser {
    activeService: ActiveService[];
  }
  
  export interface LabAdminDashboardData {
    users: LabAdminDashboardPatientItem[];
  } 
  // ============================================================
  // 7. PATIENT DETAILS — DOCTOR LIST
  //    Use case: Get list of doctors while creating lab test / prescription
  // ============================================================
  
  export type PatientDetailsDoctorItem = StaffItem

  export interface PatientDetailsDoctorListData {
    items: PatientDetailsDoctorItem[];
  }
 
  // ============================================================
  // 8. FRONTDESK CHAT — PATIENT LIST
  //    Use case: Retrieve patients of organization for frontdesk chat
  // ============================================================
  
  export interface FrontdeskChatPatientItem {
    // Identity
    userID: string;
    pk: string;
    sk: string;
    sk1: string;
    sk2?: string;
    mrn: string;
    userType: string;
    accountType: string;
    roleID: string;
    roleName: string;
    roleType: string;
    definedRoleCode: string;
    organizationID: string;

    // Personal Info
    firstName: string;
    lastName: string;
    fullName: string;
    profilePic?: string;
    doctorName?: string;
    reporterName?: string;
    reporterProfilePic?: string;

    // Contact
    emailAddress: string;
    phoneCode: string;
    phoneNumber: string;

    // Address
    city: string;
    postalCode: string;

    // Status
    isActive: boolean;
    isRpmUser: boolean;
    status: boolean;
    deleteFlag?: null;

    // Timestamps
    createdDate: number;
    createdAt: number;
    modifiedDate?: number;
  }

  export interface FrontdeskChatPatientListData {
    items: FrontdeskChatPatientItem[];
  }
 