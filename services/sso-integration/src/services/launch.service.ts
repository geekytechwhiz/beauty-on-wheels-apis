import { LaunchProcessResult, ServiceTokenResult, UserRole } from '../types/launch.types';

import { BaseService } from '../core/base.service';
import {
  CognitoUserContext,
  Patient,
  SSORequestContext,
  TruTechAppointment,
  TruTechAppointmentsResponse,
  User,
} from '../types';
import { SSOErrorCode } from '../types/enums';
import { SSOError } from '../types/errors/sso-error';
import { TruTechVerifyContext } from '../types/external/trutech.types';
import { ROLE } from '../utils/constants';
import { getEnvConfig } from '../config/env';
import { getTruTechClientForTenant } from '../clients/tru-tech.clients';
export class LaunchService extends BaseService {
   

  constructor() {
    super('LaunchService');
  }

  async processLaunch(
    launchToken: string,
    ctx: SSORequestContext,
  ): Promise<LaunchProcessResult> { 
    const { correlationId } = ctx;

    try {
      this.logger.info({
        event: 'launch_process_start',
        correlationId,
        launchTokenLength: launchToken?.length ?? 0,
      });

      const verifyResponse = await this.verifyLaunchToken(launchToken, ctx);

      this.logger.debug({
        event: 'launch_token_verified',
        correlationId,
        doctorContext: {
          email: verifyResponse.context.email,
          drid: verifyResponse.context.drid,
          tenantId: verifyResponse.context.tenant_id,
        },
      });

      const cognitoUserContext = await this.ensureDoctorExists(verifyResponse.context, ctx);

      this.logger.info({
        event: 'launch_doctor_resolved',
        correlationId,
        doctorId: cognitoUserContext?.userId,
        externalId: cognitoUserContext?.externalUserId,
      });

      const userToken:any= await this.generateUserToken(
        cognitoUserContext  
       
      );

      const appointmentsResponse = await this.fetchAppointments(
        verifyResponse.context.drid,
        ctx,
      );

      const rawAppointments = appointmentsResponse.appointments ?? [];

      this.logger.info({
        event: 'launch_appointments_fetched',
        correlationId,
        doctorId: verifyResponse.context.drid,
        appointmentCount: rawAppointments.length,
      });

      let eventsPublished = 0;

      if (rawAppointments.length > 0) {
        eventsPublished = await this.publishPatientCreationEvents(
            cognitoUserContext as unknown as User,
          rawAppointments,
          verifyResponse.context,
          ctx,
        );

        this.logger.info({
          event: 'launch_patient_events_published',
          correlationId,
          doctorId: cognitoUserContext?.userId ?? '',
          patientEventsCount: eventsPublished,
        });
      } else {
        this.logger.info({
          event: 'launch_no_appointments_skipping_patient_events',
          correlationId,
          doctorId: cognitoUserContext?.userId ?? '',
        });
      }

      const mappedAppointments = this.truTechAdapter.mapAppointments(
        rawAppointments,
      );
     const tokenResult: ServiceTokenResult = {
      accessToken: userToken.accessToken ?? '',
      updateToken: userToken.updateToken ?? '',
      refreshToken: userToken.refreshToken ?? '',
      expiresIn: userToken.expiresIn ?? 0,
      userId:  cognitoUserContext?.userId ?? '',
      role: ROLE.DOCTOR as UserRole,
     };
      return {
        doctor: cognitoUserContext as unknown as User,
        appointments: mappedAppointments,
        patientEventsPublished: eventsPublished,
        serviceToken: tokenResult,
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

  private async verifyLaunchToken(launchToken: string, ctx: SSORequestContext) {
    const response = await getTruTechClientForTenant(ctx.tenantId).verifyLaunchToken(
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
    ctx: SSORequestContext,
  ): Promise<CognitoUserContext> {
    
    const env = getEnvConfig();
    const userAttributes =
      await this.cognitoService.findCognitoUserByEmail(
        doctorContext.email,
      );
  
    if (!userAttributes) {
      throw SSOError.invalidRequest('User not yet registered');
    }
    userAttributes.password = env.COGNITO_SSO_COMMON_PASSWORD || 'Comm@n123';
    return userAttributes;
  }

  private async generateUserToken(
    cognitoUserContext: CognitoUserContext, 
  ) {
    const cognitoUsername =
      cognitoUserContext.userId ?? cognitoUserContext.email ?? cognitoUserContext.phone ?? '';
    if (!cognitoUserContext.password) {
      throw new Error('User password is required');
    }
    return this.cognitoService.generateToken(
      cognitoUsername, cognitoUserContext.password, ROLE.DOCTOR);
  }

  private async fetchAppointments(
    doctorId: number,
    ctx: SSORequestContext,
  ): Promise<TruTechAppointmentsResponse> {
    const response = await getTruTechClientForTenant(ctx.tenantId).getTodaysAppointments(
      doctorId,
      ctx.correlationId,
    );

    return response;
  }

  private async publishPatientCreationEvents(
    doctor: User,
    appointments: TruTechAppointment[] | undefined,
    doctorInfo: TruTechVerifyContext,
    ctx: SSORequestContext,
  ): Promise<number> {
    const organizationId = ctx.integration.externalHospitalId;
    if (!organizationId) {
      throw new Error('Organization ID is required in request context');
    }

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
        organizationId,
        ctx.integration.providerId,
        ctx,
        doctor?.id?.toString() ?? '', // Use internal doctor ID, not external TruTech ID
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
