/**
 * Base User Response Interface
 * Common fields shared across all user response types (staff, patients, etc.)
 */
export interface BaseUserResponse {
  // User identification
  userID: string;
  fullName: string;
  firstName: string;
  lastName: string;
  
  // Contact information
  emailAddress: string;
  phoneNumber: string;
  phoneCode: string;
  
  // Organization
  organizationID: string;
  
  // Profile
  profilePic: string;
  mrn: string;
  
  // Dates
  createdDate: number;
  createdAt: number;
  modifiedDate: number;
  
  // Status
  status: boolean;
  isActive: boolean;
  isRpmUser: boolean;
  accountType: string;
  
  // Location
  city: string;
  postalCode: string;
  
  // DynamoDB keys
  pk: string;
  sk: string;
  sk1: string;
  
  // Role information
  roleType: string;
  roleID: string;
  roleName: string;
  definedRoleCode: string;
  userType: string;
}
