import {
  createChildLogger,
  createLogger,
  createPerformanceTimer,
  serializeError,
} from '@api-hub/logger';

import { Appointment } from '../types';
import { SSOError } from '../types/errors/sso-error';
import { getTruTechClient } from '../clients/tru-tech.clients.js';
import { getTruTechAdapter } from '../adapters/trutech.adapter.ts';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class HmsAppointmentsProvider {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'HmsAppointmentsProvider',
  });

  private readonly truTechClient = getTruTechClient();
  private readonly truTechAdapter = getTruTechAdapter();

  async getTodaysAppointmentsForDoctor(
    doctorId: number,
    correlationId: string,
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, { correlationId, doctorId });
    const timer = createPerformanceTimer(logger, 'hms_get_todays_appointments');

    logger.info({
      event: 'hms_get_todays_appointments_start',
      doctorId,
    });

    try {
      if (!doctorId || doctorId <= 0) {
        throw SSOError.invalidRequest('Invalid doctor ID');
      }

      const truTechAppointmentsResponse =
        await this.truTechClient.getTodaysAppointments(doctorId, correlationId);

      logger.debug({
        event: 'hms_trutech_todays_response',
        doctorId,
        status: truTechAppointmentsResponse.status,
        hasAppointmentsArray: !!truTechAppointmentsResponse.appointments,
        appointmentCount:
          truTechAppointmentsResponse.appointments?.length ?? 0,
        hasMessage: !!truTechAppointmentsResponse.message,
      });

      timer.end();

      if (!truTechAppointmentsResponse.appointments?.length) {
        logger.info({
          event: 'hms_get_todays_appointments_no_appointments',
          doctorId,
        });
        return [];
      }

      const mapped = this.truTechAdapter.mapAppointments(
        truTechAppointmentsResponse.appointments || [],
      );

      logger.info({
        event: 'hms_get_todays_appointments_success',
        doctorId,
        appointmentCount: mapped.length,
      });

      return mapped;
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        logger.warn({
          event: 'hms_get_todays_appointments_error',
          doctorId,
          errorCode: error.code,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'hms_get_todays_appointments_unexpected_error',
        doctorId,
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to fetch today\'s appointments from HMS',
        error as Error,
      );
    }
  }

  async getAppointmentsForDoctorsInRange(
    doctorIds: number[],
    startDate: string,
    endDate: string,
    correlationId: string,
  ): Promise<Appointment[]> {
    const logger = createChildLogger(this.logger, {
      correlationId,
      doctorIds,
      startDate,
      endDate,
    });

    const timer = createPerformanceTimer(
      logger,
      'hms_get_appointments_for_doctors_in_range',
    );

    logger.info({
      event: 'hms_get_appointments_for_doctors_in_range_start',
      doctorCount: doctorIds.length,
      startDate,
      endDate,
    });

    try {
      if (!doctorIds?.length) {
        logger.info({
          event: 'hms_get_appointments_for_doctors_in_range_no_doctors',
          startDate,
          endDate,
        });
        return [];
      }

      const response = await this.truTechClient.getAppointmentsForDoctorsInRange(
        doctorIds,
        startDate,
        endDate,
        correlationId,
      );

      logger.debug({
        event: 'hms_trutech_range_response',
        status: response.status,
        hasAppointmentsArray: !!response.appointments,
        appointmentCount: response.appointments?.length ?? 0,
        hasMessage: !!response.message,
      });

      timer.end();

      if (!response.appointments?.length) {
        logger.info({
          event: 'hms_get_appointments_for_doctors_in_range_no_appointments',
          doctorCount: doctorIds.length,
          startDate,
          endDate,
        });
        return [];
      }

      const mapped = this.truTechAdapter.mapAppointments(
        response.appointments || [],
      );

      logger.info({
        event: 'hms_get_appointments_for_doctors_in_range_success',
        doctorCount: doctorIds.length,
        appointmentCount: mapped.length,
        startDate,
        endDate,
      });

      return mapped;
    } catch (error) {
      timer.end();

      if (error instanceof SSOError) {
        logger.warn({
          event: 'hms_get_appointments_for_doctors_in_range_error',
          doctorCount: doctorIds.length,
          startDate,
          endDate,
          errorCode: error.code,
          message: error.message,
        });
        throw error;
      }

      logger.error({
        event: 'hms_get_appointments_for_doctors_in_range_unexpected_error',
        doctorCount: doctorIds.length,
        startDate,
        endDate,
        err: serializeError(error as Error),
      });

      throw SSOError.internalError(
        'Failed to fetch appointments from HMS for doctors',
        error as Error,
      );
    }
  }
}

let hmsAppointmentsProviderInstance: HmsAppointmentsProvider | null = null;

export function getHmsAppointmentsProvider(): HmsAppointmentsProvider {
  if (!hmsAppointmentsProviderInstance) {
    hmsAppointmentsProviderInstance = new HmsAppointmentsProvider();
  }
  return hmsAppointmentsProviderInstance;
}

