/* eslint-disable no-useless-escape */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createLogger, createChildLogger, extractCorrelationId, serializeError } from '@api-hub/logger';
import { getLaunchService } from '../services/launch.service';
import { checkRateLimit, getRateLimitHeaders } from '../middleware/rate-limit.middleware';
import { SSOError, SSOErrorResponse } from '../types';
import { loadEnvConfig } from '../config/env';

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
        correlationId,
        {}
      );
    }

    const rateLimitResult = checkRateLimit(event);
    const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);

    if (!rateLimitResult.allowed) {
      return this.errorResponse(
        SSOError.rateLimitExceeded(),
        correlationId,
        rateLimitHeaders
      );
    }

    logger.info({
      event: 'sso_launch_request',
      path: event.path,
      method: event.httpMethod,
      hasToken: !!event.queryStringParameters?.token,
    });

    try {
      const launchToken = this.extractAndValidateToken(event, correlationId);

      const result = await this.launchService.processLaunch(launchToken, correlationId);

      const response = this.launchService.formatResponse(result);

      const duration = Date.now() - startTime;

      logger.info({
        event: 'sso_launch_success',
        durationMs: duration,
        userId: result.user.id,
        tenantId: result.user.tenantId,
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          ...rateLimitHeaders,
        },
        body: JSON.stringify(response),
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SSOError) {
        logger.warn({
          event: 'sso_launch_error',
          durationMs: duration,
          errorCode: error.code,
          statusCode: error.statusCode,
        });
        return this.errorResponse(error, correlationId, rateLimitHeaders);
      }

      logger.error({
        event: 'sso_launch_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error),
      });

      return this.errorResponse(
        SSOError.internalError('An unexpected error occurred'),
        correlationId,
        rateLimitHeaders
      );
    }
  }

  private extractAndValidateToken(
    event: APIGatewayProxyEvent,
    correlationId: string
  ): string {
    const logger = createChildLogger(this.logger, { correlationId });

    const token = event.queryStringParameters?.token;

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

  private errorResponse(
    error: SSOError,
    correlationId: string,
    additionalHeaders: Record<string, string>
  ): APIGatewayProxyResult {
    const response: SSOErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        requestId: correlationId,
      },
    };

    return {
      statusCode: error.statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-store',
        ...additionalHeaders,
      },
      body: JSON.stringify(response),
    };
  }
}

let ssoControllerInstance: SSOController | null = null;

export function getSSOController(): SSOController {
  if (!ssoControllerInstance) {
    ssoControllerInstance = new SSOController();
  }
  return ssoControllerInstance;
}
