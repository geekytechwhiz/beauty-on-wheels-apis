import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { validateListDoctorPatients } from '../validation/request.validators';
import {
  mapAllPatientResponse,
  mapLabPatientResponse,
  mapAssignedPatientResponse,
  mapDoctorPatientResponse,
} from '../utils/helpers';
import { scheduleServiceClient } from '../clients/scheduleService.client';
import { packageServiceClient } from '../clients/packageService.client';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const userService = new UserService();

const handler = async (
  req: LambdaRequest<any> & { validatedListDoctorPatients?: { filter: string; organizationID: string; userID?: string; showActiveAppointment?: boolean } },
) => {
  const data = req.validatedListDoctorPatients!;
  const { filter, organizationID, userID, showActiveAppointment } = data;
  const showConsultations = (req.body as any)?.showConsultations ?? false;
  const authHeader = req.context.authHeader;

  switch (filter) {
    case 'assigned-patient': {
      const assignedPatients = await userService.listDoctorPatients(
        userID || '',
        organizationID || '',
      );
      return mapAssignedPatientResponse(assignedPatients);
    }
    case 'all-patient': {
      if (showActiveAppointment && !userID) {
        if (!scheduleServiceClient) {
          const err: any = new Error('Schedule service not configured');
          err.statusCode = 500;
          err.code = 'LIST_DOCTOR_PATIENTS_FAILED';
          throw err;
        }
        const appointmentInfo = await scheduleServiceClient.getLatestActiveAppointments(
          organizationID,
          authHeader,
        );
        if (!appointmentInfo || appointmentInfo.length === 0) {
          return [];
        }
        let userServices: any[] = [];
        if (packageServiceClient) {
          const serviceRequests = appointmentInfo.map((appt) => {
            const r: any = { userId: appt.userId };
            if (appt.userAddonId) r.userAddonId = appt.userAddonId;
            else if (appt.userPackageId) r.userPackageId = appt.userPackageId;
            return r;
          });
          userServices = await packageServiceClient
            .getServicesByList(serviceRequests, authHeader)
            .catch(() => []);
          const scheduleMetaMap = new Map<string, Record<string, unknown>>();
          appointmentInfo.forEach((appt) => {
            if (appt.scheduleId && appt.meta) {
              scheduleMetaMap.set(appt.scheduleId, appt.meta);
            }
          });
          userServices.forEach((service) => {
            if (Array.isArray(service.scheduled)) {
              service.scheduled.forEach((schedule: any) => {
                if (schedule.scheduleId && scheduleMetaMap.has(schedule.scheduleId)) {
                  schedule.meta = scheduleMetaMap.get(schedule.scheduleId);
                }
              });
            }
          });
        }
        const activeServiceMap = new Map<string, any>();
        appointmentInfo.forEach((appt) => {
          const matchingService = userServices.find(
            (s) =>
              (appt.userAddonId && s.userAddonId === appt.userAddonId) ||
              (appt.userPackageId && s.userPackageId === appt.userPackageId),
          );
          if (matchingService) activeServiceMap.set(appt.userId, matchingService);
        });
        const patientList = await Promise.all(
          appointmentInfo.map((appt) =>
            userService
              .getUser(appt.userId, appt.patientOrgId || organizationID)
              .catch(() => null),
          ),
        );
        const validPatients = patientList.filter((p) => p !== null) as any[];
        return mapAllPatientResponse(validPatients, activeServiceMap);
      }
      const patientList = await userService.listOrganizationUsers(organizationID || '', {
        filter: filter?.toUpperCase(),
        previouslyConsulted: showConsultations,
      });
      return mapAllPatientResponse(patientList);
    }
    case 'lab-patient': {
      const labPatientList = await userService.listOrganizationUsers(organizationID || '', {
        filter: filter?.toUpperCase(),
        previouslyConsulted: showConsultations,
      });
      return mapLabPatientResponse(labPatientList);
    }
    case 'staff':
    case 'all': {
      const staffList = await userService.listOrganizationUsers(organizationID || '', {
        filter: filter?.toUpperCase(),
        previouslyConsulted: showConsultations,
      });
      return mapDoctorPatientResponse(staffList);
    }
    default: {
      const err: any = new Error(`Invalid filter: ${filter}`);
      err.statusCode = 400;
      err.code = 'LIST_DOCTOR_PATIENTS_FAILED';
      throw err;
    }
  }
};

export const main = withLambdaHandler(handler, {
  validator: validateListDoctorPatients,
});
