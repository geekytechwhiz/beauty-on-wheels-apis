import {
  createChildLogger,
  createLogger,
  extractCorrelationId,
  Logger,
  serializeError
} from '@api-hub/logger'
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'

import { ApiResponse } from '@api-hub/utils'

    import { SSORequestContext } from '../types/common/context.types'
import { SSOError } from '../types/errors/sso-error'
import { buildSSORequestContext } from '../utils/context-builder.util'
import { getEnvConfig } from '../config/env'
import { getExternalTenantsByProvider } from '../services/external-tenant.service'

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true
})

export abstract class BaseController {

  protected readonly logger = baseLogger

  protected async execute(
    event: APIGatewayProxyEvent,
    handler: (
      event: APIGatewayProxyEvent,
      context: SSORequestContext,
      logger: Logger
    ) => Promise<any>
  ): Promise<APIGatewayProxyResult> {

    const correlationId = extractCorrelationId(event)

    const requestLogger = createChildLogger(this.logger, {
      correlationId
    })
    const env = getEnvConfig()
    await getExternalTenantsByProvider(env.PROVIDER)
    const context = buildSSORequestContext(event, correlationId) 

    const startTime = Date.now()

    try {

      const result = await handler(event, context, requestLogger)

      const duration = Date.now() - startTime

      requestLogger.info({
        event: 'request_success',
        durationMs: duration
      })

      return ApiResponse.ok(
        result,
        {
          title: 'Success',
          description: 'Request successful',
          severity: 'INFO'
        },
        {
          requestId: correlationId
        }
      )

    } catch (error) {

      const duration = Date.now() - startTime

      if (error instanceof SSOError) {

        requestLogger.warn({
          event: 'request_failed',
          durationMs: duration,
          code: error.code
        })

        return this.errorResponse(error, correlationId)
      }

      requestLogger.error({
        event: 'request_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error)
      })

      return this.errorResponse(
        SSOError.internalError('Unexpected error'),
        correlationId
      )
    }
  }

  /**
   * Build SSO request context from API Gateway event
   */ 
  /**
   * Standardized error response
   */
  protected errorResponse(
    error: SSOError,
    correlationId: string
  ): APIGatewayProxyResult {

    const message = {
      title: 'Error',
      description: error.message,
      severity: 'ERROR' as const,
    }

    const options = {
      requestId: correlationId,
      headers: {
        'X-Correlation-Id': correlationId,
        'Cache-Control': 'no-store',
      },
    }

    const errorBody = {
      code: error.code,
    }

    switch (error.statusCode) {

      case 400:
        return ApiResponse.badRequest(message, options, errorBody)

      case 401:
        return ApiResponse.unauthorized(message, options, errorBody)

      case 403:
        return ApiResponse.forbidden(message, options, errorBody)

      case 404:
        return ApiResponse.notFound(message, options, errorBody)

      case 409:
        return ApiResponse.conflict(message, options, errorBody)

      default:
        return ApiResponse.internalServerError(message, options, errorBody)
    }
  }
}