import { createChildLogger, serializeError } from '@api-hub/logger';
import { BaseClient } from '@api-hub/service-clients';
import axios from 'axios';
import { SSORequestContext } from '../types/common/context.types';
import {
  Appointment,
  PendingAppointment,
} from '../types/domain/appointment.types';
import { AppointmentStatus, VisitType } from '../types/enums';
import { SSOError } from '../types/errors/sso-error';
import {
  AssignDoctorPayload,
  DoctorCreationPayload,
  PatientCreationPayload,
} from '../types/user-creation.type';
import { CreatedUserInfo, User } from '../types/user/user.types';
import { baseLogger, getOrganizationId } from '../utils/helper';
import { buildHeaders } from '../utils/request.utils';
import { CognitoService } from '../services/cognito.service';
import { UserExistenceValidator } from '../validators/user-existence.validator';

export class SSOUserServiceClient extends BaseClient {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'SSOUserServiceClient',
  });
  constructor() {
    super(process.env.USER_SERVICE_BASE_URL || '', 'user-service');
  }
  async findUserByExternalId(
    params: { externalId: string },
    context: SSORequestContext,
  ): Promise<User | null> {
    const externalUserId = params.externalId;
    const subdomain = context.integration.subdomain;

    console.info('findUserByExternalId_lookup', {
      externalUserId,
      subdomain,
      provider: context.integration.providerId,
    });

    try {
      const response = await this.client.get<{ data?: User } | User>('/users/external', {
        params: {
          tenant: subdomain,
          provider: context.integration.providerId,
          externalUserId,
        },
        headers: buildHeaders(context),
      });

      // User-service returns { success, data, message, error, meta }; user is in data
      type ExternalResponse = { data?: { userID?: string; emailAddress?: string; organizationID?: string; externalIdentity?: { externalUserId?: string; subdomain?: string; provider?: string }; [k: string]: unknown } };
      const body = response.data as ExternalResponse | null;
      const userPayload = body?.data ?? null;

      // User-service model uses userID; SSO expects id
      const userId = (userPayload?.userID ?? userPayload?.id) as string | undefined;
      if (!userId) {
        console.info('findUserByExternalId_service_not_found', {
          externalUserId,
          tenant: subdomain,
        });
        return null;
      }

      console.info('findUserByExternalId_success', {
        externalUserId,
        userId,
      });

      // Normalize to SSO User: user-service uses userID, emailAddress, organizationID, externalIdentity
      const ext = userPayload?.externalIdentity as { externalUserId?: string; subdomain?: string; provider?: string } | undefined;
      const created = userPayload?.createdDate ?? userPayload?.modifiedDate;
      const externalUserIdVal = ext?.externalUserId ?? externalUserId;
      return {
        ...userPayload,
        id: userId,
        invitedUser: userId,
        email: userPayload?.email ?? userPayload?.emailAddress,
        organizationId: userPayload?.organizationId ?? userPayload?.organizationID,
        externalId: externalUserIdVal,
        tenantId: ext?.subdomain ?? subdomain,
        provider: ext?.provider ?? context.integration.providerId,
        status: userPayload?.isActive === true ? 'ACTIVE' : userPayload?.isActive === false ? 'INACTIVE' : 'ACTIVE',
        createdAt: created != null ? String(created) : new Date().toISOString(),
        updatedAt: userPayload?.modifiedDate != null ? String(userPayload.modifiedDate) : new Date().toISOString(),
        externalUserId: externalUserIdVal,
      } as unknown as User;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // console.log('findUserByExternalId error', serializeError(error as Error));
        return null;
      }

      // console.log('findUserByExternalId error', serializeError(error as Error));

      throw SSOError.userServiceError(
        'User service doctor lookup failed',
        error as Error,
      );
    }
  }

  async createDoctor(
    payload: DoctorCreationPayload,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
    // console.log('createDoctor payload', JSON.stringify(payload));

    const response = await this.client.post<unknown>('/user', payload, {
      headers: buildHeaders(context),
    });

    // console.log('createDoctor response', response);
    const body:any = response?.data ?? response;
    // console.log('createDoctor body', body);
    const invitedUser: string | undefined =
      body?.data?.invitedUser ??
      body?.data?.id ??
      body?.data?.userId ??
      body?.data?.userID;

    const rawUserId = invitedUser;

    if (!rawUserId) {
      console.error('createDoctor_user_id_missing', {
        subdomain: context.integration.subdomain,
        externalUserId: payload.externalIdentity?.externalUserId,
        responseBody: body,
      });

      throw SSOError.userServiceError(
        'User service did not return invitedUser identifier for created doctor',
        new Error('Missing invitedUser in createDoctor response'),
      );
    }

    const emailFromPayload =
      payload.email ?? payload.userInfo?.contact?.email ?? null;

    const result: CreatedUserInfo = {
      userId: String(rawUserId),
      email: emailFromPayload,
      externalUserId: payload.externalIdentity?.externalUserId  ,
      organizationId: payload.organizationID,  
    };

    console.info('createDoctor_success', {
      externalUserId: result.externalUserId,
      userId: result.userId,
    });

    return result;
  }

  async createDoctorWithRetry(
    payload: DoctorCreationPayload,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
    const subdomain = context.integration.subdomain;
    const externalUserId = payload.externalIdentity?.externalUserId;
    const logBase = { externalUserId, subdomain };

    try {
      return await this.createDoctor(payload, context);
    } catch (err) {
      if ((err as any).code === 'ECONNABORTED') {
        console.warn('createDoctor_timeout_retry', {
          ...logBase,
          retryAttempt: 1,
        });
        return this.createDoctor(payload, context);
      }

      if (
        axios.isAxiosError(err) &&
        err.response?.status === 409 &&
        externalUserId
      ) {
        console.info('createDoctor_conflict_fetching_existing', {
          ...logBase,
          retryAttempt: 0,
        });
        const userExistenceValidator = new UserExistenceValidator(
          this,
          new CognitoService(),
          this.logger,
        );
        const existenceResult = await userExistenceValidator.checkUserExists(
          { externalId: externalUserId, email: payload.email ?? null, phone: payload.userInfo?.contact?.phone ?? null },
          context,
        );

        if (existenceResult.userServiceUser) {
          console.info('createDoctor_conflict_resolved_existing', {
            ...logBase,
            doctorUserId: existenceResult.userServiceUser.id,
          });
          const organizationId = getOrganizationId(subdomain);
          return {
              userId: String(existenceResult.userServiceUser.id),
            email:
              existenceResult.userServiceUser.email ??
              payload.email ??
              payload.userInfo?.contact?.email ??
              null,
            externalUserId,
            organizationId,
          };
        }

        console.warn('createDoctor_conflict_no_existing_user_found', {
          ...logBase,
        });
      }

      throw err;
    }
  }

  async createPatient(
    payload: PatientCreationPayload,
    context: SSORequestContext,
  ): Promise<CreatedUserInfo> {
    const subdomain = context.integration.subdomain;
    const externalUserId = payload.externalIdentity?.externalUserId;
    const organizationId = getOrganizationId(subdomain);

    // console.log('createPatient payload', JSON.stringify(payload));
    const patientCreationPayload = {
      ...payload,
      organizationId: organizationId,
      subdomain: subdomain,
    };
    
    try {
      const response = await this.client.post<{ data: User }>('/user', patientCreationPayload, {
        headers: buildHeaders(context),
      });

      const user = response.data.data;
      // console.log('createPatient user', user);

      return {
        userId: String(user?.invitedUser),
        email: user.email,
        externalUserId: externalUserId,
        organizationId,
      } as CreatedUserInfo;
    } catch (err) {
      if (
        axios.isAxiosError(err) &&
        err.response?.status === 409 &&
        externalUserId
      ) {
        console.info('createPatient_conflict_fetching_existing', {
          externalUserId,
          subdomain,
        });

        const userExistenceValidator = new UserExistenceValidator(
          this,
          new CognitoService(),
          this.logger,
        );
        const existenceResult = await userExistenceValidator.checkUserExists(
          {
            externalId: externalUserId,
            email:
              payload.userInfo?.contact?.email ?? null,
            phone:
              payload.userInfo?.contact?.phone ??
              null,
          },
          context,
        );

        if (existenceResult.userServiceUser) {
          console.info('createPatient_conflict_resolved_existing', {
            externalUserId,
            patientUserId: existenceResult.userServiceUser.id,
          });
          return {
            userId: String(existenceResult.userServiceUser.id),
            email:
              existenceResult.userServiceUser.email ??
              payload.userInfo?.contact?.email ??
              null,
            externalUserId,
            organizationId,
          };
        }
      }

      throw err;
    }
  }

  /**
   * Assigns a patient (receiver) to a doctor (sender) in an organization.
   * Wraps the `/user/assign-doctor` endpoint with SSO error handling.
   */
  async assignDoctor(
    payload: AssignDoctorPayload,
    context: SSORequestContext,
  ): Promise<{ message: string }> {
    try {
      const response = await this.client.post<{ message: string }>(
        '/user/assign-doctor',
        payload,
        { headers: buildHeaders(context) },
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const messageFromServer =
          (error.response?.data as any)?.message ||
          (status === 400
            ? 'Assign doctor request is invalid'
            : status === 404
              ? 'Doctor or patient not found'
              : 'Assign doctor request to user service failed');

        throw SSOError.userServiceError(messageFromServer, error);
      }

      throw SSOError.userServiceError(
        'Assign doctor request to user service failed',
        error as Error,
      );
    }
  }
  async storePendingAppointment(
    tenantId: string,
    pending: PendingAppointment,
    context: SSORequestContext,
  ): Promise<void> {
    try {
      const organizationID =
        pending.organizationID ?? getOrganizationId(context.integration.subdomain);

      const { appointment } = pending;
      const requestBody = {
        appointmentId:
          pending.appointmentId ?? `appt-${pending.externalAppointmentId}`,
        externalAppointmentId: pending.externalAppointmentId,
        tenantId: pending.tenantId ?? tenantId,
        organizationID,
        patientUserId: pending.patientUserId ?? pending.patientExternalId,
        doctorUserId: pending.doctorUserId ?? pending.doctorExternalId,
        patientExternalId: pending.patientExternalId,
        doctorExternalId: pending.doctorExternalId,
        startTime: new Date(appointment.startTime).getTime(),
        endTime: new Date(appointment.endTime).getTime(),
        status: 'PENDING',
        sourceSystem: context.sourceSystem,
        patientName: appointment.patient?.name,
        patientEmail: appointment.patient?.email ?? null,
        patientMrn: appointment.patient?.mrn,
        doctorName: appointment.doctor?.name,
        doctorEmail: appointment.doctor?.email,
        doctorDepartment: appointment.doctor?.department,
        consultationTypeId: appointment.consultationType?.id ?? undefined,
        consultationTypeName: appointment.consultationType?.name,
        visitId: appointment.visit?.id ?? undefined,
      };

      this.logger.info({
        event: 'store_pending_appointment_request_shape',
        correlationId: context.correlationId,
        tenantId,
        externalAppointmentId: pending.externalAppointmentId,
        patientExternalId: pending.patientExternalId,
        sourcePatientName: appointment.patient?.name ?? null,
        sourceDoctorName: appointment.doctor?.name ?? null,
        sourcePatientEmail: appointment.patient?.email ?? null,
        sourceDoctorEmail: appointment.doctor?.email ?? null,
        ...pendingDisplayFieldLogDetail(requestBody),
      });

      await this.client.post(
        '/pending-appointments',
        requestBody,
        { headers: buildHeaders(context) },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 409) {
          this.logger.info({
            event: 'store_pending_appointment_conflict_skipped',
            tenantId,
            externalAppointmentId: pending.externalAppointmentId,
            patientExternalId: pending.patientExternalId,
          });
          return;
        }
        this.logger.error({
          event: 'store_pending_appointment_error',
          status: error.response?.status,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Store pending appointment failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Store pending appointment failed',
        error as Error,
      );
    }
  }

  async getPendingAppointmentsByPatient(
    _tenantId: string,
    patientExternalId: string,
    context: SSORequestContext,
  ): Promise<PendingAppointment[]> {
    try {
      const response = await this.client.get<{
        data?: { items?: StoredPendingAppointmentItem[] };
      }>(`/users/${patientExternalId}/pending-appointments`, {
        headers: buildHeaders(context),
      });

      const items = response.data?.data?.items ?? [];
      this.logger.info({
        event: 'get_pending_appointments_response_shape',
        correlationId: context.correlationId,
        patientExternalId,
        itemCount: items.length,
        items: items.map((item) => ({
          externalAppointmentId: item.externalAppointmentId,
          appointmentId: item.appointmentId,
          ...pendingDisplayFieldLogDetail(item),
        })),
      });
      return items.map((item) =>
        mapStoredPendingAppointmentToDomain(item, patientExternalId),
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return [];
        }
        this.logger.error({
          event: 'get_pending_appointments_error',
          status: error.response?.status,
          patientExternalId,
          err: serializeError(error),
        });
        throw SSOError.downstreamError(
          `Get pending appointments failed: ${error.message}`,
          error,
        );
      }
      throw SSOError.downstreamError(
        'Get pending appointments failed',
        error as Error,
      );
    }
  }

}

function pendingDisplayFieldLogDetail(body: {
  patientName?: string | null;
  patientEmail?: string | null;
  patientMrn?: string;
  doctorName?: string;
  doctorEmail?: string;
  doctorDepartment?: string;
  consultationTypeId?: number;
  consultationTypeName?: string;
  visitId?: number;
}) {
  const patientName = body.patientName?.trim() || null;
  const patientEmail =
    body.patientEmail != null ? String(body.patientEmail).trim() || null : null;
  const patientMrn = body.patientMrn?.trim() || null;
  const doctorName = body.doctorName?.trim() || null;
  const doctorEmail = body.doctorEmail?.trim() || null;
  const doctorDepartment = body.doctorDepartment?.trim() || null;
  const consultationTypeName = body.consultationTypeName?.trim() || null;

  return {
    hasPatientName: Boolean(patientName),
    hasPatientEmail: Boolean(patientEmail),
    hasPatientMrn: Boolean(patientMrn),
    hasDoctorName: Boolean(doctorName),
    hasDoctorEmail: Boolean(doctorEmail),
    hasDoctorDepartment: Boolean(doctorDepartment),
    hasConsultationTypeId: body.consultationTypeId != null,
    hasConsultationTypeName: Boolean(consultationTypeName),
    hasVisitId: body.visitId != null,
    patientName,
    patientEmail,
    patientMrn,
    doctorName,
    doctorEmail,
    doctorDepartment,
    consultationTypeId: body.consultationTypeId ?? null,
    consultationTypeName,
    visitId: body.visitId ?? null,
  };
}

type StoredPendingAppointmentItem = {
  appointmentId?: string;
  externalAppointmentId: string;
  tenantId?: string;
  organizationID?: string;
  patientUserId?: string;
  doctorUserId?: string;
  patientExternalId: string;
  doctorExternalId: string;
  startTime: number | string;
  endTime: number | string;
  status?: string;
  sourceSystem?: string;
  createdAt?: number;
  updatedAt?: number;
  patientName?: string;
  patientEmail?: string | null;
  patientMrn?: string;
  doctorName?: string;
  doctorEmail?: string;
  doctorDepartment?: string;
  consultationTypeId?: number;
  consultationTypeName?: string;
  visitId?: number;
};

function toEpochMs(value: number | string): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function parseAppointmentNumericId(
  externalAppointmentId: string,
  appointmentId?: string,
): number {
  if (appointmentId?.startsWith('APT-')) {
    const fromPrefix = Number(appointmentId.slice(4));
    if (!Number.isNaN(fromPrefix)) {
      return fromPrefix;
    }
  }
  const parsed = Number(externalAppointmentId);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mapStoredPendingAppointmentToDomain(
  item: StoredPendingAppointmentItem,
  patientExternalId: string,
): PendingAppointment {
  const startMs = toEpochMs(item.startTime);
  const endMs = toEpochMs(item.endTime);
  const appointmentId = parseAppointmentNumericId(
    item.externalAppointmentId,
    item.appointmentId,
  );

  const appointment: Appointment = {
    appointmentId,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    status: AppointmentStatus.SCHEDULED,
    patient: {
      id: Number(item.patientExternalId),
      mrn: item.patientMrn ?? '',
      name: item.patientName ?? '',
      gender: '',
      age: null,
      dob: null,
      email: item.patientEmail ?? null,
    },
    doctor: {
      id: Number(item.doctorExternalId),
      name: item.doctorName ?? '',
      department: item.doctorDepartment ?? '',
      phone: '',
      email: item.doctorEmail ?? '',
    },
    consultationType: {
      id: item.consultationTypeId ?? 0,
      name: item.consultationTypeName ?? '',
    },
    visit: {
      id: item.visitId ?? 0,
      visitType: VisitType.OUTPATIENT,
      createdAt: new Date(startMs).toISOString(),
      status: 1,
    },
  };

  return {
    appointment,
    reason: 'user_not_resolved',
    timestamp: item.createdAt
      ? new Date(item.createdAt).toISOString()
      : new Date().toISOString(),
    retryCount: 0,
    appointmentId: item.appointmentId,
    tenantId: item.tenantId,
    organizationID: item.organizationID,
    patientUserId: item.patientUserId,
    doctorUserId: item.doctorUserId,
    patientExternalId: item.patientExternalId ?? patientExternalId,
    doctorExternalId: item.doctorExternalId,
    externalAppointmentId: item.externalAppointmentId,
  };
}

export function getSSOUserServiceClient(): SSOUserServiceClient {
  return new SSOUserServiceClient();
}
