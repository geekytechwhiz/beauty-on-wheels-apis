import { APIGatewayProxyEvent, ScheduledEvent, SQSEvent } from 'aws-lambda';
import { getEnvConfig } from '../config/env';
import { loadTenantDetails } from '../utils/helper';
import { SourceSystem, SSORequestContext } from '../types/common/context.types';
import { PatientCreationEvent } from '../types/events';

export function buildSSORequestContext(
  event:
    | APIGatewayProxyEvent
    | ScheduledEvent
    | SQSEvent
    | PatientCreationEvent,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN, SUBDOMAIN } = getEnvConfig();
  let tenantId = SUBDOMAIN;
  let serviceToken: string | null = null;

  const headers: Record<string, string | undefined> =
    (event as any)?.headers && typeof (event as any).headers === 'object'
      ? (event as any).headers
      : {};

  // Prefer explicit tenantId from headers or path when provided.
  const headerTenant =
    (headers['x-tenant-id'] as string | undefined) ||
    (headers['X-Tenant-Id'] as string | undefined);

  const pathTenant =
    (event as any)?.pathParameters?.tenantId ||
    (event as any)?.pathParameters?.tenant;

  const resolvedTenant = (headerTenant || pathTenant)?.trim();

  if (resolvedTenant) {
    tenantId = resolvedTenant;
  }

  serviceToken =
    (headers.authorization as string | undefined) ||
    (headers.Authorization as string | undefined) ||
    null;

  const tenant = loadTenantDetails(tenantId);
  return {
    correlationId,
    tenantId,
    serviceToken: serviceToken ? `${INTERNAL_SERVICE_TOKEN}` : null,
    source: 'sso-integration',
    integration: {
      providerId: tenant.provider,
      subdomain: tenantId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}

export function buildSSORequestContextFromSQS(
  event: PatientCreationEvent,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN, SUBDOMAIN } = getEnvConfig();
  const tenant = loadTenantDetails(SUBDOMAIN);
  return {
    correlationId,
    tenantId: SUBDOMAIN,
    serviceToken: INTERNAL_SERVICE_TOKEN ? `${INTERNAL_SERVICE_TOKEN}` : null,
    source: 'sso-integration',
    integration: {
      providerId: tenant.provider,
      subdomain: SUBDOMAIN,
    },
    sourceSystem: SourceSystem.HMS,
  };
}

/**
 * Build SSORequestContext from appointment queue message (tenantId, correlationId).
 * Used by appointmentProcessor when processing SQS messages from AppointmentSyncQueue.
 */
export function buildSSORequestContextFromAppointmentMessage(
  tenantId: string,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN } = getEnvConfig();
  const tenant = loadTenantDetails(tenantId);

  return {
    correlationId,
    tenantId,
    serviceToken: INTERNAL_SERVICE_TOKEN,
    source: 'sso-integration',
    integration: {
      providerId: tenant.provider,
      subdomain: tenantId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}
