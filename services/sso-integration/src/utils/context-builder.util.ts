import { APIGatewayProxyEvent, ScheduledEvent, SQSEvent } from 'aws-lambda'
import { SSORequestContext, SourceSystem } from '../types/common/context.types'
import { PROVIDER, SERVICE_TOKEN_HEADER, SUBDOMAIN } from '../utils/constants'
import { PatientCreationEvent } from '../types/events'

export function buildSSORequestContext(
  event: APIGatewayProxyEvent | ScheduledEvent | SQSEvent | PatientCreationEvent,
  correlationId: string
): SSORequestContext {
  // Default to TruTech tenant when no tenant hints are present (e.g. SQS, Scheduler)
  let tenantId = SUBDOMAIN.TRU_TECH
  let serviceToken: string | null = null

  const headers: Record<string, string | undefined> =
    (event as any)?.headers && typeof (event as any).headers === 'object'
      ? (event as any).headers
      : {}

  // Prefer explicit tenantId from headers or path when provided.
  const headerTenant =
    (headers['x-tenant-id'] as string | undefined) ||
    (headers['X-Tenant-Id'] as string | undefined)

  const pathTenant =
    (event as any)?.pathParameters?.tenantId ||
    (event as any)?.pathParameters?.tenant

  const resolvedTenant = (headerTenant || pathTenant)?.trim()

  if (resolvedTenant) {
    tenantId = resolvedTenant
  }

  serviceToken =
    (headers.authorization as string | undefined) ||
    (headers.Authorization as string | undefined) ||
    null

  return {
    correlationId,
    tenantId,
    serviceToken: serviceToken ? `${SERVICE_TOKEN_HEADER}` : null,
    source: 'sso-integration',
    integration: {
      providerId: PROVIDER.TRU_TECH,
      subdomain: tenantId
    },
    sourceSystem: SourceSystem.HMS
  }
}
 

export function buildSSORequestContextFromSQS(
  event: PatientCreationEvent,
  correlationId: string
): SSORequestContext {

  const tenantId = event?.data?.externalIdentity?.subdomain || SUBDOMAIN.TRU_TECH

  return {
    correlationId,
    tenantId,

    serviceToken: SERVICE_TOKEN_HEADER, // internal service token

    source: 'sso-integration',

    integration: {
      providerId: event?.data?.externalIdentity?.provider || PROVIDER.TRU_TECH,
      subdomain: tenantId
    },

    sourceSystem: SourceSystem.HMS
  }
}

/**
 * Build SSORequestContext from appointment queue message (tenantId, correlationId).
 * Used by appointmentProcessor when processing SQS messages from AppointmentSyncQueue.
 */
export function buildSSORequestContextFromAppointmentMessage(
  tenantId: string,
  correlationId: string
): SSORequestContext {
  return {
    correlationId,
    tenantId,
    serviceToken: SERVICE_TOKEN_HEADER,
    source: 'sso-integration',
    integration: {
      providerId: PROVIDER.TRU_TECH,
      subdomain: tenantId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}