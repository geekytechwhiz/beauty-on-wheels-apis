import { APIGatewayProxyEvent, ScheduledEvent, SQSEvent } from 'aws-lambda'
import { SSORequestContext, SourceSystem } from '../types/common/context.types'
import { PROVIDER, SERVICE_TOKEN_HEADER, SUBDOMAIN } from '../utils/constants'
import { PatientCreationEvent } from '../types/events'

export function buildSSORequestContext(
  event: APIGatewayProxyEvent | ScheduledEvent | SQSEvent | PatientCreationEvent,
  correlationId: string
): SSORequestContext {

  const tenantId =
    (event as APIGatewayProxyEvent).headers['x-tenant-id'] ||
    (event as APIGatewayProxyEvent).headers['X-Tenant-Id'] ||
    SUBDOMAIN.TRUE_TECH

  const serviceToken =
    (event as APIGatewayProxyEvent).headers.authorization ||
    (event as APIGatewayProxyEvent).headers.Authorization ||
    null
  console.log("buildSSORequestContext serviceToken", serviceToken);
  return {
    correlationId,
    tenantId,
    serviceToken: serviceToken ? `${SERVICE_TOKEN_HEADER}` : null,
    source: 'sso-integration',

    integration: {
      providerId: PROVIDER.TRUE_TECH,
      subdomain: SUBDOMAIN.TRUE_TECH
    },

    sourceSystem: SourceSystem.HMS
  }
}