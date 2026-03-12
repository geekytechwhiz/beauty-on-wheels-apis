import { APIGatewayProxyEvent, ScheduledEvent, SQSEvent } from 'aws-lambda'
import { SSORequestContext, SourceSystem } from '../types/common/context.types'
import { PROVIDER, SERVICE_TOKEN_HEADER, SUBDOMAIN } from '../utils/constants'
import { PatientCreationEvent } from '../types/events'

export function buildSSORequestContext(
  event: APIGatewayProxyEvent | ScheduledEvent | SQSEvent | PatientCreationEvent,
  correlationId: string
): SSORequestContext {

  let tenantId = SUBDOMAIN.TRUE_TECH
  let serviceToken: string | null = null

  /**
   * Only API Gateway events contain headers
   */
  if ('headers' in event && event.headers) {

    tenantId =
      event.headers['x-tenant-id'] ||
      event.headers['X-Tenant-Id'] ||
      SUBDOMAIN.TRUE_TECH

    serviceToken =
      event.headers.authorization ||
      event.headers.Authorization ||
      null
  }

  console.log('buildSSORequestContext serviceToken', serviceToken)

  return {
    correlationId,

    tenantId,

    serviceToken: serviceToken
      ? `${SERVICE_TOKEN_HEADER}`
      : null,

    source: 'sso-integration',

    integration: {
      providerId: PROVIDER.TRUE_TECH,
      subdomain: SUBDOMAIN.TRUE_TECH
    },

    sourceSystem: SourceSystem.HMS
  }
}