import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import {
  createChildLogger,
  createLogger,
  extractCorrelationId,
  serializeError
} from '@api-hub/logger'

import { ApiResponse } from '@api-hub/utils'
import { SSOError } from '../types/errors/sso-error';

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
      correlationId: string,
      logger: any
    ) => Promise<any>
  ): Promise<APIGatewayProxyResult> {

    const correlationId = extractCorrelationId(event)

    const logger = createChildLogger(this.logger, {
      correlationId
    })

    const startTime = Date.now()

    try {

      const result = await handler(event, correlationId, logger)

      const duration = Date.now() - startTime

      logger.info({
        event: 'request_success',
        durationMs: duration
      })

      return ApiResponse.ok(
        result,
        { title: 'Success', description: 'Request successful' },
        {
          requestId: correlationId,
          event,
          headers: {
            'X-Correlation-Id': correlationId,
            'Cache-Control': 'no-store'
          }
        }
      )

    } catch (error) {

      const duration = Date.now() - startTime

      if (error instanceof SSOError) {

        logger.warn({
          event: 'request_failed',
          durationMs: duration,
          code: error.code
        })

        return this.errorResponse(error, event, correlationId)

      }

      logger.error({
        event: 'request_unexpected_error',
        durationMs: duration,
        err: serializeError(error as Error)
      })

      return this.errorResponse(
        SSOError.internalError('Unexpected error'),
        event,
        correlationId
      )
    }
  }

  protected errorResponse(
    error: SSOError,
    event: APIGatewayProxyEvent,
    correlationId: string
  ): Promise<APIGatewayProxyResult> {

    return ApiResponse.error(
      error.statusCode,
      {
        title: 'Error',
        description: error.message,
        severity: 'ERROR'
      },
      {
        requestId: correlationId,
        event,
        headers: {
          'X-Correlation-Id': correlationId,
          'Cache-Control': 'no-store'
        }
      },
      {
        code: error.code
      }
    )
  }
}