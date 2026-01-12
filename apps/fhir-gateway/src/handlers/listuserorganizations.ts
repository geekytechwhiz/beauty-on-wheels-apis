/**
 * ListUserOrganizations Handler
 * GET /fhir/ListUserOrganizations/id
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'
import { toListUserOrganizations } from '@api-hub/fhir'
import {
  UserServiceServiceClient,
  ListUserOrganizationsNotFoundError,
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
  const listUserOrganizationsId = event.pathParameters?.id
  const authHeader = getAccessTokenFromHeaders(event.headers || {})

  if (!listUserOrganizationsId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    })
    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || '/fhir/ListUserOrganizations/id',
      400,
      duration,
      correlationId
    )
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'ListUserOrganizations ID is required',
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
      event.path || '/fhir/ListUserOrganizations/id',
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
    listUserOrganizationsId,
    ...(awsRequestId && { awsRequestId }),
  })
  logger.info({ event: 'fhir_listuserorganizations_get_received' })

  try {
    const listUserOrganizationsDTO = await userServiceServiceClient.getListUserOrganizations(
      listUserOrganizationsId,
      correlationId,
      authHeader
    )
    const baseUrl = event.requestContext?.domainName
      ? `https://${event.requestContext.domainName}${event.requestContext.path?.replace(/\/fhir\/ListUserOrganizations\/.*$/, '') || ''}`
      : undefined
    const listUserOrganizations = toListUserOrganizations(listUserOrganizationsDTO, baseUrl)

    const duration = Date.now() - startTime
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/fhir/ListUserOrganizations/${listUserOrganizationsId}`,
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
      body: JSON.stringify(listUserOrganizations),
    }
  } catch (err) {
    const duration = Date.now() - startTime
    if (err instanceof ListUserOrganizationsNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/fhir/ListUserOrganizations/${listUserOrganizationsId}`,
        404,
        duration,
        correlationId
      )
      return problem({
        title: 'ListUserOrganizations not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'LISTUSERORGANIZATIONS_NOT_FOUND',
      })
    }
    logger.error({ event: 'fhir_listuserorganizations_get_error', err: serializeError(err) })
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/fhir/ListUserOrganizations/${listUserOrganizationsId}`,
      500,
      duration,
      correlationId
    )
    return problem({
      title: 'Failed to get listuserorganizations',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'GET_LISTUSERORGANIZATIONS_FAILED',
    })
  }
}
