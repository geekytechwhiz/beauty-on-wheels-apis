export interface CreateUserRequest {

  data: CreateUserPayload

  roleName: string

  organizationID: string

  invitedBy?: string

  friendNFamily?: FriendFamilyInput

  assignDoctor?: AssignDoctorInput

}
export interface CreateUserPayload {

  userID?: string
  code?: string
  username?: string

  userType?: string
  itemType?: string

  userRole?: string[]
  definedRoleCode?: string

  firstName?: string
  middleName?: string
  lastName?: string
  fullName?: string
  namePrefix?: string

  emailAddress?: string
  email?: string

  phoneNumber?: string
  phone_number?: string
  phoneCode?: string

  profilePic?: string

  gender?: string
  dateOfBirth?: string

  country?: string
  state?: string
  city?: string
  street?: string
  address?: string

  zip?: string
  postalCode?: string

  countryCode?: string
  stateCode?: string

  region?: string

  phoneLocale?: string
  locale?: string
  language?: string

  userTimeZone?: string

  additionalPhoneNumbers?: string[]
  additionalEmailIDs?: string[]

  weightInKG?: string
  weightInLbs?: string
  heightInCm?: string
  heightInFeet?: string

  bloodGroup?: string
  ethnicity?: string
  maritalStatus?: string

  smoking?: string
  alcoholConsumption?: string

  chiefMedicalIssue?: string

  medicalHistory?: Record<string, unknown>

  emergencyContact?: Record<string, unknown>

  insuranceDetails?: Record<string, unknown>

  mrn?: string

  specialty?: string
  position?: string
  department?: string
  licenseNumber?: string
  experienceInYears?: string
  bio?: string

  workingHours?: Record<string, unknown>
  workSchedule?: Record<string, unknown>

  devices?: unknown[]

  deviceToken?: string
  device?: string

  pushToken?: string
  voipToken?: string

  platform?: string

  appleHealthLastSync?: string
  googleFitLastSync?: string

  appName?: string

  cloudOpt?: string

  srcRegisEntity?: string

  assignRoomNo?: string

  accountStatus?: string

  reporterId?: string
  reporterName?: string
  reporterProfilePic?: string
  reporterEmail?: string

  referred?: string
  careManager?: string
  dietician?: string
  healthCoach?: string

  isActive?: boolean
  isLoggedIn?: boolean
  isRegisteredCompletely?: boolean
  isRpmUser?: boolean
  isTaskCompleted?: boolean

  changePassword?: boolean
  logoutRequired?: boolean

  promotions?: boolean
  medication?: boolean
  appointment?: boolean
  newsAndArticles?: boolean
  emergencyVital?: boolean
  medicationReminders?: boolean
  appointmentReminders?: boolean
  activityGoals?: boolean
  healthCheckIn?: boolean
  debugMode?: boolean

  sms?: boolean
  emailNotification?: boolean
  push?: boolean
  chat?: boolean
  chat_with_push?: boolean

  garmin?: boolean
  fitbit?: boolean

  acceptedAppForms?: string[]

  dateFormat?: string

  createdDate?: number
  modifiedDate?: number

}

export interface EmergencyContact {

  name?: string

  phone?: string

  phoneCode?: string

  relation?: string

}
export interface InsuranceDetails {

  provider?: string

  policyNumber?: string

  groupNumber?: string

}
export interface Device {

  deviceId?: string

  deviceType?: string

  model?: string

}

export interface FriendFamilyInput {

  name?: string

  email?: string

  phone?: string

  phoneCode?: string

  relation?: string

}

export interface AssignDoctorInput {

  doctorId?: string

  doctorID?: string

  userId?: string

  userID?: string

}

export interface CreateUserHandlerModel {
  userInfo: Record<string, unknown>; // do NOT restrict fields to avoid breaking FE
  userRole: string | string[];
  userType: string;
  organizationID: string;
  userID: string;
  correlationId: string;
  authHeader: string;
  /** From body.userInfo when not in schema; for F&F linking. */
  friendNFamily?: FriendFamilyInput;
  /** From body.userInfo when not in schema; for doctor assignment. */
  assignDoctor?: AssignDoctorInput;
  /** Resolved from getRolePermissions in handler when available. */
  roleName?: string;
  /** Resolved from getRolePermissions in handler when available. */
  definedRoleCode?: string;
}