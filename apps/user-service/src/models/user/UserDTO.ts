import { UserType, Gender, RelationType } from '@api-hub/utils';

  export interface Address {
    street?: string;
    address?: string;
    city?: string;
    state?: string;
    stateCode?: string;
    country?: string;
    countryCode?: string;
    postalCode?: string;
    zip?: string;
  }
  
  export interface ContactInfo {
    email?: string;
    emailAddress?: string;
    phone?: string;
    phoneNumber?: string;
    phoneCode?: string;
    additionalPhoneNumbers?: string[];
    additionalEmailIDs?: string[];
  }
  
  export interface EmergencyContact {
    name?: string;
    relationship?: string;
    phoneNumber?: string;
    email?: string;
  }
  
  export interface MedicalHistory {
    allergies?: string[];
    chiefMedicalIssue?: string;
    smoking?: string;
    alcoholConsumption?: string;
    bloodGroup?: string;
    chronicConditions?: string[];
  }
  
  export interface InsuranceDetails {
    provider?: string;
    policyNumber?: string;
    groupNumber?: string;
    coverageType?: string;
  }
  
  export interface BaseUser {
    userID: string;
    organizationID: string;
    userType: UserType;
    itemType: string;
    firstName: string;
    lastName: string;
    middleName?: string;
    fullName?: string;
    namePrefix?: string;
    emailAddress?: string;
    phoneNumber?: string;
    phoneCode?: string;
    profilePic?: string;
    gender?: Gender;
    dateOfBirth?: string;
    age?: number;
    address?: string;
    city?: string;
    state?: string;
    stateCode?: string;
    country?: string;
    countryCode?: string;
    postalCode?: string;
    street?: string;
    zip?: string;
    isActive: boolean;
    isLoggedIn: boolean;
    isRpmUser: boolean;
    isTaskCompleted: boolean;
    

    isDeleted: boolean;
    isRegisteredCompletely: boolean;
    emailVerified: boolean;
    phoneVerified: boolean;
    changePassword: boolean;
    mfaEnabled?: boolean;
    createdDate: number;
    modifiedDate: number;
    tokenUpdatedAt?: number;
    userCat: string[];
    locale?: string;
    language?: string;
    userTimeZone?: string;
    region?: string;
    srcRegisEntity?: string;
    /** Legacy: inviter user ID (create-user flow). */
    invitedBy?: string;
    /** Legacy: invite code prefix (e.g. INVITE#code). */
    inviteCode?: string;
    /** Legacy: invite code value. */
    invitedID?: string;
    /** Legacy: force logout on next request. */
    logoutRequired?: boolean;
    /** Role code (e.g. ADMIN, FRIEND, FAMILY) for notification skip and display. */
    definedRoleCode?: string;
  }
  
  export interface PatientUser extends BaseUser {
    userType: UserType.USER;
    mrn: string;
    weightInLbs?: string;
    weightInKG?: string;
    heightInCm?: string;
    heightInFeet?: string;
    medicalHistory?: MedicalHistory;
    emergencyContact?: EmergencyContact;
    insuranceDetails?: InsuranceDetails;
    allergies?: string[];
    chiefMedicalIssue?: string;
    smoking?: string;
    alcoholConsumption?: string;
    bloodGroup?: string;
    ethnicity?: string;
    maritalStatus?: string;
    reporterId?: string;
    reporterName?: string;
    reporterProfilePic?: string;
    reporterEmail?: string;
    reporterSpecialty?: string;
    referred?: string;
    careManager?: string;
    dietician?: string;
    healthCoach?: string;
    assignedDoctors?: Array<{
      userID: string;
      fullName: string;
      profilePic?: string;
      specialty?: string;
      emailAddress?: string;
      organizationID: string;
    }>;
    isRpmUser: boolean;
    devices?: Array<{
      deviceId: string;
      deviceType: string;
      assignedDate?: string;
    }>;
    lastAppointment?: string;
    generalSettings?: {
      promotions: boolean;
      medication: boolean;
      appointment: boolean;
      newsAndArticles: boolean;
      emergencyVital: boolean;
      medicationReminders: boolean;
      appointmentReminders: boolean;
      activityGoals: boolean;
      healthCheckIn: boolean;
      debugMode: boolean;
    };
    communicationSettings?: {
      sms: boolean;
      email: boolean;
      push: boolean;
      chat: boolean;
      chat_with_push: boolean;
    };
    fitnessApps?: {
      garmin: boolean;
      fitbit: boolean;
    };
    appleHealthLastSync?: string;
    googleFitLastSync?: string;
    isTaskCompleted: boolean;
    acceptedAppForms?: string[];
    units?: {
      bloodPressureUnit?: string;
      glucometerUnit?: string;
      heartBeatUnit?: string;
      heightUnit?: string;
      oximeterUnit?: string;
      temperatureUnit?: string;
      weightUnit?: string;
      cholesterolUnit?: string;
      water?: string;
      distance?: string;
    };
    platform?: string;
    pushToken?: string;
    voipToken?: string;
    deviceToken?: string;
    inviteDetails?: {
      invitedBy?: string;
      invitedDate?: string;
      inviteCode?: string;
    };
    accountAge?: {
      years: number;
      months: number;
      days: number;
    };
  }
  
  export interface StaffUser extends BaseUser {
    userType: UserType.STAFF | UserType.ADMIN;
    licenseNumber?: string;
    specialty?: string;
    department?: string;
    position?: string;
    experienceInYears?: string;
    bio?: string;
    code?: string;
    slotDurationInMinutes?: number;
    workingHours?: {
      monday?: { start: string; end: string };
      tuesday?: { start: string; end: string };
      wednesday?: { start: string; end: string };
      thursday?: { start: string; end: string };
      friday?: { start: string; end: string };
      saturday?: { start: string; end: string };
      sunday?: { start: string; end: string };
    };
    workSchedule?: Record<string, any>;
    assignRoomNo?: string;
    totalPatients?: number;
    activePatients?: number;
    communicationSettings?: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
    platform?: string;
    pushToken?: string;
  }
  
  export interface FnFUser extends BaseUser {
    userType: UserType.FNF;
    relation?: RelationType;
    relationship?: string;
    emergencyContact: boolean;
    manageHealth: boolean;
    medicalHistory?: Partial<MedicalHistory>;
    inviteDetails?: {
      invitedBy?: string;
      invitedDate?: string;
      inviteCode?: string;
      inviterName?: string;
    };
    communicationSettings?: {
      email: boolean;
      sms: boolean;
      push: boolean;
    };
    platform?: string;
    pushToken?: string;
  }
  
  export interface CreatePatientInput {
    organizationID: string;
    userID?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    emailAddress?: string;
    phoneNumber?: string;
    phoneCode?: string;
    middleName?: string;
    namePrefix?: string;
    gender?: Gender;
    dateOfBirth?: string;
    age?: number;
    profilePic?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    mrn?: string;
    medicalHistory?: MedicalHistory;
    emergencyContact?: EmergencyContact;
    insuranceDetails?: InsuranceDetails;
    assignDoctor?: {
      doctorId: string;
    };
    friendNFamily?: {
      name: string;
      email?: string;
      phone?: string;
      phoneCode?: string;
      relation: string;
    };
    userRole?: string[];
    devices?: any[];
  }
  
  export interface CreateStaffInput {
    organizationID: string;
    userID?: string;
    emailAddress: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    phoneNumber?: string;
    phoneCode?: string;
    licenseNumber?: string;
    specialty?: string;
    department?: string;
    position?: string;
    experienceInYears?: string;
    bio?: string;
    code?: string;
    slotDurationInMinutes?: number;
    workingHours?: Record<string, any>;
    assignRoomNo?: string;
    userRole?: string[];
    age?: number;
  }
  
  export interface CreateFnFInput {
    organizationID: string;
    userID?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    emailAddress?: string;
    phoneNumber?: string;
    phoneCode?: string;
    relation: RelationType;
    relationship?: string;
    emergencyContact: boolean;
    manageHealth?: boolean;
    inviteDetails?: {
      invitedBy: string;
      inviterName: string;
    };
    age?: number;
  }
  
  export interface PatientResponse extends Omit<PatientUser, 'passwordHash' | 'tokenUpdatedAt'> {
    accountAge: {
      years: number;
      months: number;
      days: number;
    };
    organizationName: string;
    organizationAddress: Address;
    organizationEmailAddress: string;
    roleName: string;
    roleType: string;
    roleId: string;
    userRoles: string[];
    userPermissions: any[];
    permission: any;
    isDefault: boolean;
    definedRoleCode?: string;
    scheduleConfiguration: any;
    currencies: any[];
    dateFormat: string;
    tabBar: any[];
    fnfDetails?: {
      userID: string;
      firstName: string;
      lastName: string;
      fullName: string;
      emailAddress: string;
      phoneNumber: string;
      profilePic: string;
      organizationID: string;
      gender: string;
      permissions: any;
    };
  }
  
  export interface StaffResponse extends Omit<StaffUser, 'passwordHash' | 'tokenUpdatedAt'> {
    organizationName: string;
    organizationAddress: Address;
    roleName: string;
    roleType: string;
    roleId: string;
    userRoles: string[];
    userPermissions: any[];
    permission: any;
    definedRoleCode?: string;
    currencies: any[];
    dateFormat: string;
  }
  
  export interface FnFResponse extends Omit<FnFUser, 'passwordHash' | 'tokenUpdatedAt'> {
    organizationName: string;
    roleName: string;
    userPermissions: any[];
    definedRoleCode?: string;
  }
  
  export function isPatientUser(user: BaseUser): user is PatientUser {
    return user.userType === UserType.USER;
  }
  
  export function isStaffUser(user: BaseUser): user is StaffUser {
    return user.userType === UserType.STAFF || user.userType === UserType.ADMIN;
  }
  
  export function isFnFUser(user: BaseUser): user is FnFUser {
    return user.userType === UserType.FNF;
  }
  
  export type UserRequestModel = PatientUser | StaffUser | FnFUser;
  
  export type CreateUserInput = CreatePatientInput | CreateStaffInput | CreateFnFInput;
  
  export type UserResponse = PatientResponse | StaffResponse | FnFResponse;

  