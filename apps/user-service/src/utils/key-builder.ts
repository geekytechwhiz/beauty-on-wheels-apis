export const KeyBuilder = {

    userPk: (userId: string) => `USER#${userId}`,
  
    orgPk: (orgId: string) => `ORG#${orgId}`,
  
    orgUserPk: (orgId: string) => `ORG#${orgId}`,
  
    userSk: (userId: string) => `USER#${userId}`,
  
    userFileSk: (fileId: string) => `USER_FILE#${fileId}`,
  
    doctorAssigneeSk: (patientId: string) => `ASSIGNEE#${patientId}`,
  
    assignedDoctorSk: (doctorId: string) => `ASSIGNED_TO#${doctorId}`,
  
    roleSk: (roleId: string) => `ROLE#${roleId}`,
  
  };