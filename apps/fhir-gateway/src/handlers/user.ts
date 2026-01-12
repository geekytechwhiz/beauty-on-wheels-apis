/**
 * User Handler
 * GET /fhir/User/id
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'
import { toUser } from '@api-hub/fhir'
import { UserServiceServiceClient } from '../services/user-service.client'
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger'
import { problem } from '../utils/response'
import { getAccessTokenFromHeaders } from '../utils/helper'

const baseLogger = createLogger({ service: 'fhir-gateway', redactPII: true })
const userServiceServiceClient = new UserServiceServiceClient()

export async function main(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now()
  const correlationId = extractCorrelationId(event)
  const awsRequestId = context ? extractAwsRequestId(context) : undefined
  const userId = event.pathParameters?.id
  const authHeader = getAccessTokenFromHeaders(event.headers || {})

  if (!userId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    })
    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || '/fhir/User/id',
      400,
      duration,
      correlationId
    )
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'User ID is required',
      correlationId,
      code: 'BAD_REQUEST',
    })
  }

  if (!authHeader) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    })
    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || '/fhir/User/id',
      401,
      duration,
      correlationId
    )
    return problem({
      title: 'Unauthorized',
      status: 401,
      detail: 'Access token is required',
      correlationId,
      code: 'UNAUTHORIZED',
    })
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId,
    ...(awsRequestId && { awsRequestId }),
  })
  logger.info({ event: 'fhir_user_get_received' })

  try {
    const userDTO = await userServiceServiceClient.getUser(userId, correlationId, authHeader)
    const baseUrl = event.requestContext?.domainName
      ? `https://${event.requestContext.domainName}${event.requestContext.path?.replace(/\/fhir\/User\/.*$/, '') || ''}`
      : undefined
    const user = toUser(userDTO, baseUrl)

    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/fhir/User/${userId}`,
      200,
      duration,
      correlationId
    )

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/fhir+json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify(user),
    }
  } catch (err) {
    const duration = Date.now() - startTime
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/fhir/User/${userId}`,
        404,
        duration,
        correlationId
      )
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      })
    }
    logger.error({ event: 'fhir_user_get_error', err: serializeError(err) })
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/fhir/User/${userId}`,
      500,
      duration,
      correlationId
    )
    return problem({
      title: 'Failed to get user',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'GET_USER_FAILED',
    })
  }
}
