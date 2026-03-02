/* eslint-disable no-useless-escape */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createLogger, createChildLogger, extractCorrelationId, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils'; 
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware';
import { SSOError } from '../types';
import { loadEnvConfig } from '../config/env';
import { getLaunchService } from '../services/launch.service';

const baseLogger = createLogger({ service: 'sso-integration', redactPII: true });

const TOKEN_MIN_LENGTH = 10;
const TOKEN_MAX_LENGTH = 4096;

export class SSOController {
  private readonly logger = createChildLogger(baseLogger, { component: 'SSOController' });
  private readonly launchService = getLaunchService();

  async handleLaunch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
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
      event: 'sso_launch_request',
      path: event.path,
      method: event.httpMethod,
      hasQueryParams: !!event.queryStringParameters,
      hasBody: !!event.body,
    });

    try {
      const { token: launchToken } = this.extractLaunchParams(
        event,
        correlationId
      );

      // Process full launch flow: verify token, create/retrieve doctor, publish patient events
      const launchResult = await this.launchService.processLaunch(launchToken, correlationId);

      const duration = Date.now() - startTime;

      logger.info({
        event: 'sso_launch_success',
        durationMs: duration,
        doctorId: launchResult.doctor.id,
        appointmentCount: launchResult.appointments.length,
        patientEventsPublished: launchResult.patientEventsPublished,
      });

      return ApiResponse.ok(
        {
          doctor: {
            id: launchResult.doctor.id,
            externalId: launchResult.doctor.externalId,
            provider: launchResult.doctor.provider,
            tenantId: launchResult.doctor.tenantId,
          },
          appointments: launchResult.appointments,
          patientEventsPublished: launchResult.patientEventsPublished,
        },
        { title: 'Success', description: 'Launch processed successfully' },
        {
          requestId: correlationId,
          event,
          headers: {
            'X-Correlation-Id': correlationId,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            ...rateLimitHeaders,
          },
        },
      );
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SSOError) {
        logger.warn({
          event: 'sso_launch_error',
          durationMs: duration,
          errorCode: error.code,
          statusCode: error.statusCode,
        });
        return this.errorResponse(error, event, correlationId, rateLimitHeaders);
      }

      logger.error({
        event: 'sso_launch_unexpected_error',
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

  private extractAndValidateTokenFromValue(token: string | undefined, correlationId: string): string {
    const logger = createChildLogger(this.logger, { correlationId });

    if (!token) {
      logger.warn({
        event: 'missing_token',
      });
      throw SSOError.invalidToken('Missing required token parameter');
    }

    if (token.length < TOKEN_MIN_LENGTH) {
      logger.warn({
        event: 'token_too_short',
        tokenLength: token.length,
        minLength: TOKEN_MIN_LENGTH,
      });
      throw SSOError.invalidToken('Token is too short');
    }

    if (token.length > TOKEN_MAX_LENGTH) {
      logger.warn({
        event: 'token_too_long',
        tokenLength: token.length,
        maxLength: TOKEN_MAX_LENGTH,
      });
      throw SSOError.invalidToken('Token is too long');
    }

    const tokenPattern = /^[A-Za-z0-9_\-\.]+$/;
    if (!tokenPattern.test(token)) {
      logger.warn({
        event: 'token_invalid_format',
      });
      throw SSOError.invalidToken('Token contains invalid characters');
    }

    logger.debug({
      event: 'token_validated',
      tokenLength: token.length,
    });

    return token;
  }

  private extractLaunchParams(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): { token: string; module?: string } {
    const logger = createChildLogger(this.logger, { correlationId });

    let rawToken: string | undefined;
    let rawModule: string | undefined;

    if (event.httpMethod.toUpperCase() === 'GET') {
      rawToken = event.queryStringParameters?.token;
      rawModule = event.queryStringParameters?.module ?? undefined;
    } else if (event.httpMethod.toUpperCase() === 'POST') {
      if (!event.body) {
        logger.warn({
          event: 'missing_body_for_post_launch',
        });
        throw SSOError.invalidRequest('Request body is required for POST /sso/launch');
      }

      try {
        const parsed = JSON.parse(event.body) as {
          token?: string;
          module?: string;
        };

        rawToken = parsed.token;
        rawModule = parsed.module;
      } catch (error) {
        logger.warn({
          event: 'invalid_json_body',
          err: serializeError(error as Error),
        });
        throw SSOError.invalidRequest('Request body must be valid JSON');
      }
    } else {
      logger.warn({
        event: 'unsupported_http_method',
        method: event.httpMethod,
      });
      throw SSOError.invalidRequest('HTTP method not supported for /sso/launch');
    }

    const token = this.extractAndValidateTokenFromValue(rawToken, correlationId);
    const module = this.validateModuleName(rawModule, correlationId);

    logger.debug({
      event: 'launch_params_extracted',
      hasModule: !!module,
    });

    return { token, module };
  }

  private validateModuleName(
    module: string | undefined,
    correlationId: string
  ): string | undefined {
    const logger = createChildLogger(this.logger, { correlationId });

    if (!module) {
      return undefined;
    }

    const trimmed = module.trim().toLowerCase();

    if (!trimmed) {
      return undefined;
    }

    const modulePattern = /^[a-z0-9_-]+$/;
    if (!modulePattern.test(trimmed)) {
      logger.warn({
        event: 'module_invalid_format',
      });
      throw SSOError.invalidRequest('Module contains invalid characters');
    }

    return trimmed;
  }

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

let ssoControllerInstance: SSOController | null = null;

export function getSSOController(): SSOController {
  if (!ssoControllerInstance) {
    ssoControllerInstance = new SSOController();
  }
  return ssoControllerInstance;
}
