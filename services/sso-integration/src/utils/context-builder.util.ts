import { APIGatewayProxyEvent, ScheduledEvent, SQSEvent } from 'aws-lambda';
import { getEnvConfig } from '../config/env';
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
  // Default to TruTech tenant when no tenant hints are present (e.g. SQS, Scheduler)
  const {
    SUBDOMAIN,
    INTERNAL_SERVICE_TOKEN,
    DOCTOR_ROLE_ID,
    PATIENT_ROLE_ID,
    SSO_DEFAULT_ORGANIZATION_ID,
    PROVIDER,
  } = getEnvConfig();
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

  return {
    correlationId,
    tenantId,
    serviceToken: serviceToken ? `${INTERNAL_SERVICE_TOKEN}` : null,
    source: 'sso-integration',
    integration: {
      providerId: PROVIDER,
      subdomain: tenantId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}

export function buildSSORequestContextFromSQS(
  event: PatientCreationEvent,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN, PROVIDER, SUBDOMAIN } = getEnvConfig();
  return {
    correlationId,
    tenantId: SUBDOMAIN,

    serviceToken: INTERNAL_SERVICE_TOKEN ? `${INTERNAL_SERVICE_TOKEN}` : null, // internal service token

    source: 'sso-integration',

    integration: {
      providerId: PROVIDER,
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
  const { INTERNAL_SERVICE_TOKEN, PROVIDER } = getEnvConfig();

  return {
    correlationId,
    tenantId,
    serviceToken: INTERNAL_SERVICE_TOKEN,
    source: 'sso-integration',
    integration: {
      providerId: PROVIDER,
      subdomain: tenantId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}
