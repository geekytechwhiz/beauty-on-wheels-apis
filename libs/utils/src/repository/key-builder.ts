/**
 * DynamoDB Key Builder
 * Central place for all PK / SK patterns
 */

export const KeyBuilder = {
    /* -----------------------------
     USER KEYS
    ------------------------------*/
  
    userPk: (userId: string) => `USER#${userId}`,
  
    userSk: (userId: string) => `USER#${userId}`,
  
    orgUserPk: (orgId: string) => `ORG#${orgId}`,
  
    orgUserSk: (userId: string) => `USER#${userId}`,
  
    userOrgPk: (userId: string) => `USER#${userId}`,
  
    userOrgSk: (orgId: string) => `ORG#${orgId}`,
  
    userBasicDetailsSk: (orgId: string) => `USER_BASIC_DETAILS#${orgId}`,
  
    /* -----------------------------
     USER FILE
    ------------------------------*/
  
    userFileSk: (fileId: string) => `USER_FILE#${fileId}`,
  
    /* -----------------------------
     USER METADATA
    ------------------------------*/
  
    userMetadataSk: () => `ORG#`,
  
    /* -----------------------------
     USER PREFERENCES
    ------------------------------*/
  
    userPreferenceSk: () => `PREFERENCE`,
  
    /* -----------------------------
     DOCTOR PATIENT LINKS
    ------------------------------*/
  
    doctorPatientSk: (patientId: string) => `ASSIGNEE#${patientId}`,
  
    patientDoctorSk: (doctorId: string) => `ASSIGNED_TO#${doctorId}`,
  
    dieticianPatientSk: (patientId: string) => `DIETICIAN#${patientId}`,
  
    healthCoachPatientSk: (patientId: string) => `HEALTHCOACH#${patientId}`,
  
    careManagerPatientSk: (patientId: string) => `CAREMANAGER#${patientId}`,
  
    previouslyConsultedSk: (patientId: string) => `SCD_LINK#${patientId}`,
  
    /* -----------------------------
     ROLE KEYS
    ------------------------------*/
  
    rolePk: (orgId: string) => `ORG#${orgId}`,
  
    roleSk: (roleId: string) => `ROLE#${roleId}`,
  
    userRolePk: (orgId: string) => `USER_ROLE#${orgId}`,
  
    userRoleSk1: (userId: string) => `${userId}#`,
  
    /* -----------------------------
     USER COUNT
    ------------------------------*/
  
    orgUserCountPk: (orgId: string) => `ORG_USER_COUNT#${orgId}`,
  
    orgUserCountSk: (roleId: string, status: string) =>
      `${roleId}#${status}`,
  
    /* -----------------------------
     TASK KEYS
    ------------------------------*/
  
    taskPk: (userId: string) => `TASK#${userId}`,
  
    taskPendingSk: () => `PENDING`,
  
    /* -----------------------------
     CURRENCY KEYS
    ------------------------------*/
  
    currencyPk: () => `CURRENCIES`,
  
    currencyCountrySk: (countryCode: string) =>
      `COUNTRY#${countryCode}`,
  
    /* -----------------------------
     GENERIC HELPERS
    ------------------------------*/
  
    beginsWith: (prefix: string) => prefix,
  
    orgPrefix: () => "ORG#",
  
    userPrefix: () => "USER#"
  };