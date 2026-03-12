
export interface User{
  pk: string;
  sk: string;
  acceptedAppForms?: Array<{
    acceptedDate: number;
    docId: string;
    versionId: string;
  }>;
  accountStatus?: string;
  additionalEmailIDs?: string[];
  additionalPhoneNumbers?: string[];
  address?: string;
  appleHealthLastSync?: string;
  appName?: string;
  assignRoomNo?: string;
  bio?: string;
  bloodGroup?: string;
  changePassword?: boolean;
  code?: string;
  roleName: string;
  chiefMedicalIssue?: string;
  cloudOpt?: string;
  country?: string;
  countryCode?: string;
  createdDate: number;
  dateOfBirth?: string;
  dateFormat?: string;
  definedRoleCode?: string;
  department?: string;
  emailAddress: string;
  emailVerified?: boolean;
  emergencyContact?: Record<string, unknown>;
  ethnicity?: string;
  experienceInYears?: string;
  firstLoggedIn?: number;
  firstName?: string;
  fullName?: string;
  gender?: string;
  generalSetting?: Record<string, unknown>;
  googleFitLastSync?: string;
  heightInCm?: string;
  heightInFeet?: string;
  insuranceDetails?: Record<string, unknown>;
  inviteCode?: string;
  inviteDetails?: {
    email?: boolean;
    emailUpdatedAt?: string;
    sms?: boolean;
    smsUpdatedAt?: string;
  };
  invitedBy?: string;
  invitedID?: string;
  invitedDate?: string;
  tokenUpdatedAt?: number;
  isActive?: boolean;
  isLoggedIn?: boolean;
  isRegisteredCompletely?: boolean;
  isRpmUser?: boolean;
  isTaskCompleted?: boolean;
  language?: string;
  lastAppointment?: string;
  lastName?: string;
  lastRequestTime?: number;
  lastUsedAccount?: number;
  licenseNumber?: string;
  locale?: string;
  logoutAt?: number;
  logoutRequired?: boolean;
  maritalStatus?: string;
  medicalHistory?: {
    allergies?: string[];
    chronicDiseases?: string[];
    symptoms?: string[];
  };
  communicationSettings?: Record<string, unknown>;
  middleName?: string;
  modifiedDate: number;
  mrn?: string;
  namePrefix?: string;
  organizationID: string;
  phoneCode?: string;
  phoneLocale?: string;
  phoneNumber: string;
  phoneVerified?: boolean;
  position?: string;
  postalCode?: string;
  prevLastUsedAccount?: number;
  profilePic?: string;
  referred?: Array<{
    id: string;
    name: string;
    profilePic: string;
  }>;
  region?: string;
  reporterEmail?: string;
  reporterId?: string;
  reporterName?: string;
  reporterProfilePic?: string;
  specialty?: string;
  smoking?: string;
  alcoholConsumption?: string;
  srcRegisEntity?: string;
  state?: string;
  stateCode?: string;
  street?: string;
  city?: string;
  userCat?: string[];
  userID: string;
  userTimeZone?: string;
  userType?: string;
  unitsSettings?: Record<string, unknown>;
  workingHours?: Record<string, unknown>;
  slotDurationInMinutes?: number;
  weightInKG?: string;
  weightInLbs?: string;
  zip?: string;
  itemType?: string; 
  assignedPackages?: Array<{ id: string; name: string; start?: string; end?: string }>; 
  assignedPackagesName?: string[]; 
  externalIdentity?: ExternalIdentity;
}

export const SourceSystem = {
  HMS: 'HMS',
  FHIR: 'FHIR',
  CUSTOM: 'CUSTOM',
  MARKETPLACE: 'MARKETPLACE',
} as const;
export interface ExternalIdentity {
  integrationType: string; // TruTech
  externalUserId: string; // user id from external system
  externalHospitalId?: string; // org id or tenant id
  subdomain: string;  
  sourceSystem: typeof SourceSystem; 
  provider: string;
};
export interface UserResponse {
  phoneNumber: string;
  createdDate: number;
  userType: string;
  lastName: string;
  isRpmUser: boolean;
  profilePic: string;
  mrn: string;
  modifiedDate: number;
  fullName: string;
  firstName: string;
  roleID: string;
  city: string;
  roleType: string;
  isActive: boolean;
  inviteDetails?: {
    email?: boolean;
    emailUpdatedAt?: string;
    sms?: boolean;
    smsUpdatedAt?: string;
  };
  accountType: string;
  emailAddress: string;
  userID: string;
  organizationID: string;
  phoneCode: string;
  sk: string;
  pk: string;
  postalCode: string;
  sk1: string;
  status: boolean;
  createdAt: number; 
  roleName: string;
  definedRoleCode: string;
  specialty: string;
}
