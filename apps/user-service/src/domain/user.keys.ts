export const UserKeys = {
    orgPk: (organizationId: string): string => `ORG#${organizationId}`,
  
    userPk: (userId: string): string => `USER#${userId}`,
  
    userSk: (userId: string): string => `USER#${userId}`,
  
    orgSk: (organizationId: string): string => `ORG#${organizationId}`,
  
    userOrgPK: (organizationId: string): string => `ORG#${organizationId}`,
  
    userOrgSK: (userId: string): string => `USER#${userId}`,
  
    orgUserPK: (userId: string): string => `USER#${userId}`,
  
    orgUserSK: (organizationId: string): string => `ORG#${organizationId}`,
  
    userFileSK: (fileId: string): string => `USER_FILE#${fileId}`,
  
    metadataSK: (): string => `ORG#`,
  
    preferenceSKPrefix: (): string => `PREFERENCE`,
  
    userBasicDetailsSK: (organizationId: string): string =>
      `USER_BASIC_DETAILS#${organizationId}`,
  
    doctorPatientPK: (doctorId: string): string => `USER#${doctorId}`,
  
    doctorPatientSK: (patientId: string): string => `ASSIGNEE#${patientId}`,
  
    patientDoctorPK: (patientId: string): string => `USER#${patientId}`,
  
    patientDoctorSK: (doctorId: string): string => `ASSIGNED_TO#${doctorId}`,
  
    dieticianPatientSK: (patientId: string): string => `DIETICIAN#${patientId}`,
  
    healthCoachPatientSK: (patientId: string): string =>
      `HEALTHCOACH#${patientId}`,
  
    careManagerPatientSK: (patientId: string): string =>
      `CAREMANAGER#${patientId}`,
  
    previouslyConsultedSK: (patientId: string): string =>
      `SCD_LINK#${patientId}`,
  
    userRolePK: (organizationId: string): string =>
      `USER_ROLE#${organizationId}`,
  
    userRoleSK1Prefix: (userId: string): string => `${userId}#`,
  
    rolePK: (organizationId: string): string => `ORG#${organizationId}`,
  
    roleSK: (roleId: string): string => `ROLE#${roleId}`,
  
    roleSKPrefix: (roleId: string): string => `ROLE#${roleId}`,
  
    orgUserCountPK: (organizationId: string): string =>
      `ORG_USER_COUNT#${organizationId}`,
  
    orgUserCountSK: (roleId: string, status: string): string =>
      `${roleId}#${status}`,
  
    currencyPK: (): string => `CURRENCIES`,
  
    currencySK: (countryCode: string): string => `COUNTRY#${countryCode}`,
  };