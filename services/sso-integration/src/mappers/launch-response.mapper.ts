import { LaunchProcessResult } from "../types/launch.types";
 export function mapLaunchResponse(result: LaunchProcessResult) {

  return {
    doctor: {
      id: result.doctor.id,
      externalId: result.doctor.externalId,
      provider: result.doctor.provider,
      tenantId: result.doctor.tenantId
    },

    appointments: result.appointments,

    accessToken: result.serviceToken.accessToken,
    expiresIn: result.serviceToken.expiresIn,
    updateToken: result.serviceToken.updateToken,
    userId: result.serviceToken.userId,
    role: result.serviceToken.role
  };
}