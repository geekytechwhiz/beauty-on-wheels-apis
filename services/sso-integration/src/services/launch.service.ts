import { LaunchProcessResult } from '../types/launch.types';

import { 
  Patient,  
  User, 
  RequestContext,
  TruTechAppointment,
  TruTechAppointmentsResponse,
} from '../types';
 
import { BaseService } from '../core/base.service';
import { getCreateDoctorMapper } from '../mappers/create-doctor.mapper';
import { TruTechVerifiedPayload, TruTechVerifyContext } from '../types/appointment.types';
import { SSOError } from '../types/errors/sso-error';
import { SSOErrorCode } from '../types/enums';

export class LaunchService extends BaseService {
  private readonly doctorMapper = getCreateDoctorMapper();

  constructor() {
    super('LaunchService');
  }

  async processLaunch(
    launchToken: string,
    correlationId: string,
  ): Promise<LaunchProcessResult> {
    const ctx: RequestContext = { correlationId };

    try {
      const verifyResponse = await this.verifyLaunchToken(launchToken, ctx);

      const doctor = await this.ensureDoctorExists(verifyResponse.context, ctx);

      const serviceToken = await this.generateServiceToken(
        doctor,
        verifyResponse.context,
      );

      const appointments :any = await this.fetchAppointments(
        verifyResponse.context.drid,
        ctx,
      );

      const eventsPublished = await this.publishPatientCreationEvents(
        doctor,
        appointments,
        verifyResponse.context,
        ctx,
      );

      return {
        doctor,
        appointments: appointments?.map((appointment:any) => this.truTechAdapter.mapAppointments(appointment as unknown as TruTechAppointmentsResponse)) || [],
        patientEventsPublished: eventsPublished,
        serviceToken,
      };
    } catch (error) {
      this.logger.error({
        event: 'launch_process_failed',
        error:
          error instanceof Error
            ? {
                name: error.name || 'UnknownError',
                message: error.message,
                stack: error.stack,
              }
            : { name: 'UnknownError', message: String(error) },
      });

      throw new SSOError(
        SSOErrorCode.INTERNAL_ERROR,
        'Failed to process launch token',
        500,
        error as Error,
      );
    }
  }

  private async verifyLaunchToken(launchToken: string, ctx: RequestContext) {
    const response = await this.truTechClient.verifyLaunchToken(
      launchToken,
      ctx.correlationId,
    );

    if (!response) {
      throw new SSOError(
        SSOErrorCode.INVALID_LAUNCH_TOKEN,
        'Invalid launch token',
      );
    }

    return response;
  }

  private async ensureDoctorExists(
    doctorContext: TruTechVerifyContext,
    ctx: RequestContext,
  ): Promise<User> {
    const userAttributes: TruTechVerifiedPayload | null =
      await this.cognitoService.findUserByEmail(doctorContext.email);
    console.log("USER ATTRIBUTES : ",userAttributes);
    if (userAttributes?.doctorUid) {
      return {
        id: userAttributes.doctorUid,
        externalId: doctorContext.drid,
        provider: 'TruTech',
        tenantId: doctorContext.tenant_id,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const payload = this.doctorMapper.mapTruTechDoctorToOurSystem(
      doctorContext,
      ctx.correlationId,
    );

    const newDoctor = await this.userServiceClient.createDoctor(payload, {
      token: '',
      correlationId: ctx.correlationId,
    });

    this.logger.info({
      event: 'doctor_created',
      userId: newDoctor.id,
    });

    return newDoctor;
  }

  private async generateServiceToken(
    doctor: User,
    doctorContext: TruTechVerifyContext,
  ) {
    return this.serviceTokenService.generateToken(doctorContext.tenant_id, {
      userId: doctor.id.toString(),
      role: 'DOCTOR',
      appointmentId: doctorContext.drid,
    });
  }

  private async fetchAppointments(
    doctorId: number,
    ctx: RequestContext,
  ): Promise< TruTechAppointment[] | undefined> {
    const response = await this.truTechClient.getTodaysAppointments(
      doctorId,
      ctx.correlationId,
    );

    return response.appointments;
  }

  private async publishPatientCreationEvents(
    doctor: User,
    appointments: TruTechAppointment[] | undefined,
    doctorInfo: TruTechVerifyContext,
    ctx: RequestContext,
  ): Promise<number> {
    const uniquePatients = new Map<number, Patient>();

    for (const appointment of appointments || []) {
      if (appointment.patient?.id) {
        uniquePatients.set(appointment.patient.id, appointment.patient as Patient);
      }
    }

    if (!uniquePatients.size) return 0;

    const events = Array.from(uniquePatients.values()).map((patient) =>
      this.patientEventPublisher.createPatientCreationEvent(
        patient,
        doctorInfo.drid,
        this.config.defaultOrganizationID,
        'TruTech',
        ctx.correlationId,
      ),
    );

    await this.patientEventPublisher.publishPatientCreationEventsBatch(
      events,
      ctx.correlationId,
    );

    return events.length;
  }
}

let launchServiceInstance: LaunchService | null = null;

export function getLaunchService(): LaunchService {
  if (!launchServiceInstance) {
    launchServiceInstance = new LaunchService();
  }

  return launchServiceInstance;
}
