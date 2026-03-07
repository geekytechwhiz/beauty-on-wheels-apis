import { ulid } from "ulid";

export function buildUserData(
  userInfo: any,
  userType: string,
  userRole: any
) {
  const newUserId =
  (userInfo?.code as string)?.trim() || ulid();
  const contactAddress = userInfo.contact?.address;

  const userTypeUpper = String(userType || "").toUpperCase();

  const data = {

    ...userInfo,

    fullName: userInfo.name,
    namePrefix: userInfo.namePrefix,
    profilePic: userInfo.profilePic,
    code: userInfo.code,
    licenseNumber: userInfo.licenseNumber,

    emailAddress: userInfo.contact?.email,
    phoneNumber: userInfo.contact?.phone,
    phoneCode: userInfo.contact?.phoneCode,

    address: contactAddress?.address || userInfo.address || "",
    city: contactAddress?.city || userInfo.city || "",
    state: contactAddress?.state || userInfo.state || "",
    country: contactAddress?.country || userInfo.country || "",
    postalCode: contactAddress?.postalCode || userInfo.postalCode || "",
    street: contactAddress?.street || "",
    zip: contactAddress?.zip || "",
    countryCode: contactAddress?.countryCode || "",
    stateCode: contactAddress?.stateCode || "",

    userRole,
    userType,

    ...(userTypeUpper === "STAFF"
      ? { workingHours: userInfo.workingHours || {} }
      : userInfo.workingHours
      ? { workingHours: userInfo.workingHours }
      : {}),

    emergencyContact: userInfo.emergencyContact || {},
    medicalHistory: userInfo.medicalHistory || {},
    insuranceDetails: userInfo.insuranceDetails || {},
    workSchedule: userInfo.workSchedule || {},
    inviteDetails: userInfo.inviteDetails || {},

    position: userInfo.position || "",
    userTimeZone: userInfo.userTimeZone || "",
    devices: userInfo.devices || [],

    assignRoomNo: userInfo.assignRoomNo || undefined,
    username: userInfo.username || undefined,
    userID: newUserId,
  };

  const isEmail = Boolean(userInfo.contact?.email?.includes("@"));

  data.srcRegisEntity = isEmail ? "email" : "phone_number";

  return data;

}