import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createLogger, createChildLogger, extractCorrelationId, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAppointmentsService } from '../services/appointments.service';
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware';
import { SSOError } from '../types/errors/sso-error';
import { loadEnvConfig } from '../config/env';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

export class AppointmentsController {
  private readonly logger = createChildLogger(baseLogger, { component: 'AppointmentsController' });
  private readonly appointmentsService = getAppointmentsService();

  // ---------------------------------------------------------------------------
  // GET /appointments/today
  // Requires: doctorId from JWT claims or query param
  // ---------------------------------------------------------------------------

  async handleGetTodaysAppointments(
    event: APIGatewayProxyEvent
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
        {}
      );
    }

    const rateLimitResult = checkRateLimit(event);
    const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);

    if (!rateLimitResult.allowed) {
      return this.errorResponse(
        SSOError.rateLimitExceeded(),
        event,
        correlationId,
        rateLimitHeaders
      );
    }

    logger.info({
      event: 'get_appointments_request',
      path: event.path,
      method: event.httpMethod,
    });

    try {
      const doctorId = this.extractDoctorId(event, correlationId);

      const appointments = await this.appointmentsService.getTodaysAppointments(
        doctorId,
        correlationId
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'get_appointments_success',
        durationMs: duration,
        doctorId,
        appointmentCount: appointments.length,
      });

      return ApiResponse.ok(
        this.appointmentsService.formatAppointmentsResponse(appointments),
        { title: 'Success', description: 'Today\'s appointments fetched successfully' },
        {
          requestId: correlationId,
          event,
          headers: {
            'X-Correlation-Id': correlationId,
            'Cache-Control': 'private, max-age=60',
            ...rateLimitHeaders,
          },
        },
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SSOError) {
        logger.warn({
          event: 'get_appointments_error',
          durationMs: duration,
          errorCode: error.code,
          statusCode: error.statusCode,
        });
        return this.errorResponse(error, event, correlationId, rateLimitHeaders);
      }

      logger.error({
        event: 'get_appointments_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      return this.errorResponse(
        SSOError.internalError('An unexpected error occurred'),
        event,
        correlationId,
        rateLimitHeaders
      );
    }
  }

  // ---------------------------------------------------------------------------
  // GET /appointments/{patientId}/emr
  // Requires: patientId from path, doctorId from JWT claims
  // ---------------------------------------------------------------------------

  async handleGetPatientEMR(
    event: APIGatewayProxyEvent
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
        {}
      );
    }

    const rateLimitResult = checkRateLimit(event);
    const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);

    if (!rateLimitResult.allowed) {
      return this.errorResponse(
        SSOError.rateLimitExceeded(),
        event,
        correlationId,
        rateLimitHeaders
      );
    }

    logger.info({
      event: 'get_patient_emr_request',
      path: event.path,
      method: event.httpMethod,
      pathParameters: event.pathParameters,
    });

    try {
      const patientId = this.extractPatientIdFromPath(event, correlationId);
      const doctorId = this.extractDoctorId(event, correlationId);

      const emrSummary = await this.appointmentsService.getPatientEMRSummary(
        patientId,
        doctorId,
        correlationId
      );

      const duration = Date.now() - startTime;

      logger.info({
        event: 'get_patient_emr_success',
        durationMs: duration,
        patientId,
        visitCount: emrSummary.visits.length,
      });

      return ApiResponse.ok(
        this.appointmentsService.formatEMRResponse(emrSummary),
        { title: 'Success', description: 'Patient EMR fetched successfully' },
        {
          requestId: correlationId,
          event,
          headers: {
            'X-Correlation-Id': correlationId,
            'Cache-Control': 'private, max-age=300',
            ...rateLimitHeaders,
          },
        },
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SSOError) {
        logger.warn({
          event: 'get_patient_emr_error',
          durationMs: duration,
          errorCode: error.code,
          statusCode: error.statusCode,
        });
        return this.errorResponse(error, event, correlationId, rateLimitHeaders);
      }

      logger.error({
        event: 'get_patient_emr_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      return this.errorResponse(
        SSOError.internalError('An unexpected error occurred'),
        event,
        correlationId,
        rateLimitHeaders
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Extract Doctor ID from JWT claims or query params
  // ---------------------------------------------------------------------------

  private extractDoctorId(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): number {
    const logger = createChildLogger(this.logger, { correlationId });

    // Try to get from authorizer context (JWT claims)
    const authorizerClaims = event.requestContext?.authorizer;
    if (authorizerClaims?.claims) {
      const doctorIdClaim = authorizerClaims.claims['custom:doctor_id'];
      if (doctorIdClaim) {
        const doctorId = parseInt(doctorIdClaim, 10);
        if (!isNaN(doctorId) && doctorId > 0) {
          logger.debug({
            event: 'doctor_id_from_claims',
            doctorId,
          });
          return doctorId;
        }
      }
    }

    // Try to get from custom authorizer context
    if (authorizerClaims?.doctorId) {
      const doctorId = parseInt(authorizerClaims.doctorId, 10);
      if (!isNaN(doctorId) && doctorId > 0) {
        logger.debug({
          event: 'doctor_id_from_authorizer',
          doctorId,
        });
        return doctorId;
      }
    }

    logger.warn({
      event: 'doctor_id_not_found',
      hasAuthorizerClaims: !!authorizerClaims,
    });

    throw SSOError.unauthorized('Doctor ID not found in request');
  }

  // ---------------------------------------------------------------------------
  // Private: Extract Patient ID from Path Parameters
  // ---------------------------------------------------------------------------

  private extractPatientIdFromPath(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): number {
    const logger = createChildLogger(this.logger, { correlationId });

    const patientIdParam = event.pathParameters?.patientId;

    if (!patientIdParam) {
      logger.warn({
        event: 'patient_id_missing',
      });
      throw SSOError.invalidRequest('Patient ID is required');
    }

    const patientId = parseInt(patientIdParam, 10);

    if (isNaN(patientId) || patientId <= 0) {
      logger.warn({
        event: 'patient_id_invalid',
        patientIdParam,
      });
      throw SSOError.invalidRequest('Invalid patient ID');
    }

    return patientId;
  }

  // ---------------------------------------------------------------------------
  // Private: Error Response Builder
  // ---------------------------------------------------------------------------

  private errorResponse(
    error: SSOError,
    event: APIGatewayProxyEvent,
    correlationId: string,
    additionalHeaders: Record<string, string>
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

let appointmentsControllerInstance: AppointmentsController | null = null;

export function getAppointmentsController(): AppointmentsController {
  if (!appointmentsControllerInstance) {
    appointmentsControllerInstance = new AppointmentsController();
  }
  return appointmentsControllerInstance;
}
