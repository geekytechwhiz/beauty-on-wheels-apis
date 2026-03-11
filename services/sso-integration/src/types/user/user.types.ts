export interface User {
    id: string | number
    externalId: string | number
    provider: string
    tenantId: string
    
    email?: string
    phone?: string
    firstName?: string
    lastName?: string
  
    status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
  
    cognitoUsername?: string
    doctorId?: number | string
    partnerSource?: string
    organizationId?: string
  
    launchSource?: string
  
    createdAt: string
    updatedAt: string
  }
  export interface CognitoUserAttributes {
    userId: string;
    organizationId: string;
    userType: string;
    tenantSubdomain: string;
    roles: string[];
    permissions: string[];
    email?: string;
    phone?: string;
    username?: string;
  }
  export enum UserType {
    STAFF = "STAFF",
    PATIENT = "PATIENT",
    DOCTOR = "DOCTOR",
    ADMIN = "ADMIN",
    SUPER_ADMIN = "SUPER_ADMIN",
  }
  export type AuthType =
  | "USER"
  | "SERVICE"
  | "SYSTEM"
  | "PUBLIC";
  export interface CognitoUserClaims {
    sub: string;
    email_verified: boolean;
    phone_number_verified: boolean;
  
    "cognito:username": string;
  
    "custom:organizationID": string;
    "custom:id": string;
    "custom:userID": string;
    "custom:userType": UserType;
  
    "custom:permissions"?: string;
    "custom:role"?: string;
    "custom:externalUserId"?: string;
    "custom:providerId"?: string;
    "custom:subdomain"?: string;
    "custom:organizationExternalId"?: string;
    email?: string;
    phone_number?: string;
  
    auth_time: number;
    exp: number;
    iat: number;
  
    iss: string;
    aud: string;
    token_use: "id" | "access";
  } 

  export interface CognitoUserContext {
    permissions?: string[];
  
    email?: string;
    phone?: string;
  
   
    principalId: string
  
    organizationId?: string
    userId?: string
    userType?: string
  
    roles?: string[]
    refinedRoles?: string[]
  
    service?: string
    externalTenant?: string
    externalUserId?: string
    providerId?: string

    subdomain?: string
    
    organizationExternalId?: string
  
    authType: "USER" | "SERVICE" | "EXTERNAL"

  }
 