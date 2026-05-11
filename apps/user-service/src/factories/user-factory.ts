import { ulid } from 'ulid' 
import {
  PatientUser,
  StaffUser,
  FnFUser,
  CreatePatientInput,
  CreateStaffInput,
  CreateFnFInput,
  UserRequestModel,
} from '../models/user/UserDTO'
import { UserType } from '@api-hub/utils' 

export class UserFactory {
 
  private static normalizeName(input: {
    firstName?: string
    lastName?: string
    fullName?: string
  }) {

    let firstName = input.firstName || ''
    let lastName = input.lastName || ''

    if (!firstName && !lastName && input.fullName) {
      const parts = input.fullName.trim().split(/\s+/)
      firstName = parts[0] || ''
      lastName = parts.slice(1).join(' ') || ''
    }

    const fullName =
      input.fullName || [firstName, lastName].filter(Boolean).join(' ')

    return { firstName, lastName, fullName }
  }

  private static normalizeEmail(email?: string) {
    if (!email) return undefined
    return email.toLowerCase().trim()
  }

  private static normalizePhone(phone?: string) {
    if (!phone) return undefined
    return phone.trim()
  }

  private static now() {
    return Date.now()
  }

  private static tokenTimestamp() {
    return Math.floor(Date.now() / 1000)
  }

  private static generateMRN(): string {
    const now = Date.now()
    const timePart = now.toString(36).toUpperCase().padStart(6, '0')
    const randomPart = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0')

    return `PI-${timePart}${randomPart}`
  }

  static createDoctor(
    data: Partial<UserRequestModel>,
    options: {
      invitedBy?: string;
      code?: string;
      userCat?: string[];
      isRpmUser?: boolean;
    }
  ): UserRequestModel {

    const now = Date.now();

    const normalizedEmail = data.emailAddress
      ? String(data.emailAddress).trim().toLowerCase()
      : "";

    const phoneNumberForDB = data.phoneNumber
      ? String(data.phoneNumber).trim()
      : "";

    const user: Partial<UserRequestModel> = {
      ...data,

      phoneNumber: phoneNumberForDB,

      emailAddress: normalizedEmail || data.emailAddress || "",

      createdDate: data.createdDate ?? now,

      modifiedDate: data.modifiedDate ?? now,

      isActive: data.isActive ?? true,

      isLoggedIn: data.isLoggedIn ?? false,

      isRegisteredCompletely: data.isRegisteredCompletely ?? false,

      isRpmUser: data.isRpmUser ?? options.isRpmUser ?? false,

      isTaskCompleted: data.isTaskCompleted ?? false,

      changePassword: data.changePassword ?? true,

      logoutRequired: data.logoutRequired ?? false,

      itemType: data.userType ?? "USER",

      invitedBy: options.invitedBy || data.invitedBy || "",

      srcRegisEntity:
        data.srcRegisEntity ||
        (normalizedEmail ? "email" : "phone_number"),

      inviteCode: options.code ? `INVITE#${options.code}` : undefined,

      invitedID: options.code || undefined,

      tokenUpdatedAt: Math.floor(Date.now() / 1000),

      userCat: options.userCat ?? ["STAFF"],

      ...(data.definedRoleCode !== undefined
        ? { definedRoleCode: String(data.definedRoleCode) }
        : {}),
    };

    return user as UserRequestModel;
  }
  static createPatient(input: CreatePatientInput): PatientUser {

    const now = this.now()
    const userID = input.userID || ulid()

    const { firstName, lastName, fullName } =
      this.normalizeName(input)

    const patient: Partial<PatientUser> = {

      userID,
      organizationID: input.organizationID,

      userType: UserType.USER,
      itemType: UserType.USER,

      firstName,
      lastName,
      middleName: input.middleName,
      fullName,
      namePrefix: input.namePrefix,

      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      age: input.age,
      emailAddress: this.normalizeEmail(input.emailAddress),
      phoneNumber: this.normalizePhone(input.phoneNumber),
      phoneCode: input.phoneCode?.trim(),

      profilePic: input.profilePic,

      address: input.address,
      city: input.city,
      state: input.state,
      country: input.country,
      postalCode: input.postalCode,

      mrn: input.mrn || this.generateMRN(),

      medicalHistory: input.medicalHistory,
      emergencyContact: input.emergencyContact,
      insuranceDetails: input.insuranceDetails,

      isActive: true,
      isDeleted: false,

      isRegisteredCompletely: false,

      isRpmUser: !!(input.devices && input.devices.length > 0),

      emailVerified: false,
      phoneVerified: false,

      changePassword: true,

      createdDate: now,
      modifiedDate: now,

      tokenUpdatedAt: this.tokenTimestamp(),

      userCat: ['USER'],

      isTaskCompleted: false,

      generalSettings: {
        promotions: true,
        medication: true,
        appointment: true,
        newsAndArticles: true,
        emergencyVital: true,
        medicationReminders: true,
        appointmentReminders: true,
        activityGoals: true,
        healthCheckIn: true,
        debugMode: false,
      },

      communicationSettings: {
        sms: true,
        email: true,
        push: true,
        chat: false,
        chat_with_push: true,
      },

      devices: input.devices,

      srcRegisEntity: input.emailAddress
        ? 'email'
        : 'phone_number',
    }

    return patient as PatientUser;
  }

  /* -------------------------------------------------------------------------- */
  /* STAFF USER                                                                 */
  /* -------------------------------------------------------------------------- */

  static createStaff(input: CreateStaffInput): StaffUser {

    const now = this.now()
    const userID = input.userID || ulid()

    const { firstName, lastName, fullName } =
      this.normalizeName(input)

    const staff: Partial<StaffUser> = {

      userID,
      organizationID: input.organizationID,

      userType: UserType.STAFF,
      itemType: 'STAFF',

      firstName,
      lastName,
      fullName,

      emailAddress: this.normalizeEmail(input.emailAddress)!,

      phoneNumber: this.normalizePhone(input.phoneNumber),
      phoneCode: input.phoneCode?.trim(),

      licenseNumber: input.licenseNumber,
      specialty: input.specialty,
      department: input.department,
      position: input.position,

      experienceInYears: input.experienceInYears,

      bio: input.bio,

      code: input.code,
      age: input.age,
      slotDurationInMinutes: input.slotDurationInMinutes || 15,

      workingHours: input.workingHours,

      assignRoomNo: input.assignRoomNo,

      isActive: true,
      isDeleted: false,

      isRegisteredCompletely: false,

      emailVerified: false,
      phoneVerified: false,

      changePassword: true,

      createdDate: now,
      modifiedDate: now,

      tokenUpdatedAt: this.tokenTimestamp(),

      userCat: ['STAFF'],

      communicationSettings: {
        email: true,
        sms: true,
        push: true,
      },

      srcRegisEntity: 'email',
    }

    return staff as StaffUser;
  }
 
  static createFnF(input: CreateFnFInput): FnFUser {

    const now = this.now()
    const userID = input.userID || ulid()

    const { firstName, lastName, fullName } =
      this.normalizeName(input)

    const fnf: Partial<FnFUser> = {

      userID,
      organizationID: input.organizationID,

      userType: UserType.FNF,
      itemType: 'FNF',
      firstName,
      lastName,
      fullName,

      emailAddress: this.normalizeEmail(input.emailAddress),

      phoneNumber: this.normalizePhone(input.phoneNumber),
      phoneCode: input.phoneCode?.trim(),

      relation: input.relation,
      relationship: input.relationship,

      emergencyContact: input.emergencyContact,
      age: input.age,
      manageHealth: input.manageHealth || false,

      isActive: true,
      isDeleted: false,

      isRegisteredCompletely: false,

      emailVerified: false,
      phoneVerified: false,

      changePassword: true,

      createdDate: now,
      modifiedDate: now,

      tokenUpdatedAt: this.tokenTimestamp(),

      userCat: ['FNF'],

      communicationSettings: {
        email: true,
        sms: true,
        push: true,
      },

      inviteDetails: input.inviteDetails,

      srcRegisEntity: input.emailAddress
        ? 'email'
        : 'phone_number',
    }

    return fnf as FnFUser;
  }
}