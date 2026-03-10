import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createChildLogger,
  createLogger,
  extractCorrelationId,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAppointmentSyncService } from '../services/appointment-sync.service';
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware';
import { SSOError } from '../types/errors/sso-error';
import { loadEnvConfig } from '../config/env';
import { buildSchedulerContext } from '../context/context-factory';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class AppointmentSyncController {
  private readonly logger = createChildLogger(baseLogger, {
    component: 'AppointmentSyncController',
  });
  private readonly appointmentSyncService = getAppointmentSyncService();

  async handleSyncAppointments(
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> {
    const correlationId = extractCorrelationId(event);
    const logger = createChildLogger(this.logger, { correlationId });
    const startTime = Date.now();

    try {
      loadEnvConfig();
    } catch (error) {
      logger.error({
        event: 'config_validation_error',
        err: serializeError(error as Error),
      });
      return this.errorResponse(
        SSOError.internalError('Service configuration error'),
        event,
        correlationId,
        {},
      );
    }

    const rateLimitResult = checkRateLimit(event);
    const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);

    if (!rateLimitResult.allowed) {
      return this.errorResponse(
        SSOError.rateLimitExceeded(),
        event,
        correlationId,
        rateLimitHeaders,
      );
    }

    logger.info({
      event: 'appointment_sync_request',
      path: event.path,
      method: event.httpMethod,
      queryStringParameters: event.queryStringParameters,
    });

    try {
      const doctorId = this.extractDoctorIdFromQuery(event, correlationId);

      const context = await buildSchedulerContext(
        doctorId?.toString(), // tenantId
        correlationId
      );

      const result = await this.appointmentSyncService.syncAppointments(
        doctorId,
        context,
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'appointment_sync_success',
        durationMs: duration,
        doctorId,
        summary: {
          total: result.totalAppointments,
          synced: result.synced,
          skipped: result.skipped,
          failed: result.failed,
          pending: result.pending,
        },
      });

      return ApiResponse.ok(
        this.appointmentSyncService.formatSyncResponse(result),
        {
          title: 'Success',
          description: 'Appointment sync completed successfully',
          severity: 'SUCCESS',
        },
        { requestId: correlationId, headers: { 'X-Correlation-Id': correlationId, 'Cache-Control': 'private, max-age=60', ...rateLimitHeaders } },
        
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SSOError) {
        logger.warn({
          event: 'appointment_sync_error',
          durationMs: duration,
          errorCode: error.code,
          statusCode: error.statusCode,
        });
        return this.errorResponse(error, event, correlationId, rateLimitHeaders);
      }

      logger.error({
        event: 'appointment_sync_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      return this.errorResponse(
        SSOError.internalError('An unexpected error occurred'),
        event,
        correlationId,
        rateLimitHeaders,
      );
    }
  }

  private extractDoctorIdFromQuery(
    event: APIGatewayProxyEvent,
    correlationId: string,
  ): number {
    const logger = createChildLogger(this.logger, { correlationId });

    const doctorIdParam = event.queryStringParameters?.doctorId;

    if (!doctorIdParam) {
      logger.warn({
        event: 'doctor_id_missing',
      });
      throw SSOError.invalidRequest('doctorId query parameter is required');
    }

    const doctorId = parseInt(doctorIdParam, 10);

    if (Number.isNaN(doctorId) || doctorId <= 0) {
      logger.warn({
        event: 'doctor_id_invalid',
        doctorIdParam,
      });
      throw SSOError.invalidRequest('Invalid doctorId');
    }

    return doctorId;
  }

  private errorResponse(
    error: SSOError,
    event: APIGatewayProxyEvent,
    correlationId: string,
    additionalHeaders: Record<string, string>,
  ): Promise<APIGatewayProxyResult> {
    return ApiResponse.error(
      error.statusCode,
      { title: 'Error', description: error.message, severity: 'ERROR' },
      {
        requestId: correlationId,
        event,
        headers: {
          'X-Correlation-Id': correlationId,
          'Cache-Control': 'no-store',
          ...additionalHeaders,
        },
      },
      { code: error.code },
    );
  }
}

let appointmentSyncControllerInstance: AppointmentSyncController | null = null;

export function getAppointmentSyncController(): AppointmentSyncController {
  if (!appointmentSyncControllerInstance) {
    appointmentSyncControllerInstance = new AppointmentSyncController();
  }
  return appointmentSyncControllerInstance;
}

