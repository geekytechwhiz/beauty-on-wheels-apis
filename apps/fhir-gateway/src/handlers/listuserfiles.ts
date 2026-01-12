/**
 * ListUserFiles Handler
 * GET /fhir/ListUserFiles/id
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'
import { toListUserFiles } from '@api-hub/fhir'
import {
  UserServiceServiceClient,
  ListUserFilesNotFoundError,
} from '../services/user-service.client'
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
  const listUserFilesId = event.pathParameters?.id
  const authHeader = getAccessTokenFromHeaders(event.headers || {})

  if (!listUserFilesId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    })
    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || '/fhir/ListUserFiles/id',
      400,
      duration,
      correlationId
    )
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'ListUserFiles ID is required',
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
      event.path || '/fhir/ListUserFiles/id',
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
    listUserFilesId,
    ...(awsRequestId && { awsRequestId }),
  })
  logger.info({ event: 'fhir_listuserfiles_get_received' })

  try {
    const listUserFilesDTO = await userServiceServiceClient.getListUserFiles(
      listUserFilesId,
      correlationId,
      authHeader
    )
    const baseUrl = event.requestContext?.domainName
      ? `https://${event.requestContext.domainName}${event.requestContext.path?.replace(/\/fhir\/ListUserFiles\/.*$/, '') || ''}`
      : undefined
    const listUserFiles = toListUserFiles(listUserFilesDTO, baseUrl)

    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/fhir/ListUserFiles/${listUserFilesId}`,
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
      body: JSON.stringify(listUserFiles),
    }
  } catch (err) {
    const duration = Date.now() - startTime
    if (err instanceof ListUserFilesNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/fhir/ListUserFiles/${listUserFilesId}`,
        404,
        duration,
        correlationId
      )
      return problem({
        title: 'ListUserFiles not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'LISTUSERFILES_NOT_FOUND',
      })
    }
    logger.error({ event: 'fhir_listuserfiles_get_error', err: serializeError(err) })
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/fhir/ListUserFiles/${listUserFilesId}`,
      500,
      duration,
      correlationId
    )
    return problem({
      title: 'Failed to get listuserfiles',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'GET_LISTUSERFILES_FAILED',
    })
  }
}
