import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  createChildLogger,
  createLogger,
  extractCorrelationId,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAppointmentSyncService } from '../services/appointment-sync.service';
import { getServiceTokenService } from '../services/service-token.service';
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware';
import { SSOError } from '../types/errors/sso-error';
import { loadEnvConfig } from '../config/env';
import { buildSchedulerContext } from '../context/context-factory';
import { IntegrationMetadata } from '../types/integration.types';

const BEARER_PREFIX = /^Bearer\s+/i;

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

    // Service-to-service: require and verify service token (not user Cognito JWT)
    const authError = this.verifyServiceToken(event, logger);
    if (authError) {
      return authError;
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

      const integration = this.extractIntegration(event);

      const context = await buildSchedulerContext(
        integration ?? doctorId.toString(),
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
          total: result.total ?? result.totalAppointments,
          synced: result.synced,
          skipped: result.skipped,
          failed: result.failed,
          pending: result.pending,
          duplicates: result.duplicates ?? 0,
          conflicts: result.conflicts ?? 0,
          validationFailed: result.validationFailed ?? 0,
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

  /**
   * Verifies the request is authorized with a service token (JWT signed with SERVICE_TOKEN_SECRET).
   * Used for service-to-service calls; do not use user Cognito JWT for this endpoint.
   * Returns an error response to return, or null if authorized.
   */
  private verifyServiceToken(
    event: APIGatewayProxyEvent,
    logger: ReturnType<typeof createChildLogger>,
  ): APIGatewayProxyResult | null {
    const authHeader =
      (event.headers?.Authorization as string | undefined) ||
      (event.headers?.authorization as string | undefined);

    if (!authHeader || !BEARER_PREFIX.test(authHeader)) {
      logger.warn({ event: 'appointment_sync_service_token_missing' });
      return this.errorResponse(
        SSOError.unauthorized('Missing or invalid Authorization header; use Bearer <service-token>'),
        event,
        extractCorrelationId(event),
        {},
      );
    }

    const token = authHeader.replace(BEARER_PREFIX, '').trim();
    if (!token) {
      logger.warn({ event: 'appointment_sync_service_token_empty' });
      return this.errorResponse(
        SSOError.unauthorized('Missing service token'),
        event,
        extractCorrelationId(event),
        {},
      );
    }

    try {
      getServiceTokenService().verifyToken(token);
      return null;
    } catch {
      logger.warn({ event: 'appointment_sync_service_token_invalid' });
      return this.errorResponse(
        SSOError.unauthorized('Invalid or expired service token'),
        event,
        extractCorrelationId(event),
        {},
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

  private extractIntegration(
    event: APIGatewayProxyEvent,
  ): IntegrationMetadata | undefined {
    if (event.body) {
      try {
        const parsed = JSON.parse(event.body) as {
          integration?: IntegrationMetadata;
        };
        if (parsed.integration?.providerId && parsed.integration?.subdomain) {
          return {
            providerId: parsed.integration.providerId,
            subdomain: parsed.integration.subdomain,
            externalHospitalId: parsed.integration.externalHospitalId,
          };
        }
      } catch {
        // Ignore body parse errors and fall through to query parsing
      }
    }

    const qs = event.queryStringParameters;
    if (qs?.integration) {
      try {
        const parsed = JSON.parse(qs.integration) as IntegrationMetadata;
        if (parsed.providerId && parsed.subdomain) {
          return {
            providerId: parsed.providerId,
            subdomain: parsed.subdomain,
            externalHospitalId: parsed.externalHospitalId,
          };
        }
      } catch {
        // Ignore query parse errors
      }
    }

    return undefined;
  }

  private errorResponse(
    error: SSOError,
    event: APIGatewayProxyEvent,
    correlationId: string,
    additionalHeaders: Record<string, string>,
  ): APIGatewayProxyResult {
    return ApiResponse.error(
      error.statusCode,
      { title: 'Error', description: error.message, severity: 'ERROR' },
      {
        requestId: correlationId,
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

