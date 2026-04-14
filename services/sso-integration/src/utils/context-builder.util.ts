import { APIGatewayProxyEvent, ScheduledEvent, SQSEvent } from 'aws-lambda';
import { getEnvConfig } from '../config/env';
import { loadTenantDetails } from '../utils/helper';
import { SourceSystem, SSORequestContext } from '../types/common/context.types';
import { PatientCreationEvent } from '../types/events';
import { ExternalIdentity } from '../types/user-creation.type';
import { ExternalTenant } from '../services/external-tenant.service';

export function buildSSORequestContext(
  event:
    | APIGatewayProxyEvent
    | ScheduledEvent
    | SQSEvent
    | PatientCreationEvent,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN } = getEnvConfig();
  let tenantId: string | null = null;
  let serviceToken: string | null = null;

  const eventLike = event as {
    headers?: Record<string, string | undefined>;
    pathParameters?: { tenantId?: string; tenant?: string };
  };

  const headers: Record<string, string | undefined> =
    eventLike?.headers && typeof eventLike.headers === 'object'
      ? eventLike.headers
      : {};

  // Prefer explicit tenantId from headers or path when provided.
  const headerTenant =
    (headers['x-tenant-id'] as string | undefined) ||
    (headers['X-Tenant-Id'] as string | undefined);

  const pathTenant =
    eventLike?.pathParameters?.tenantId ||
    eventLike?.pathParameters?.tenant;

  const resolvedTenant = (headerTenant || pathTenant)?.trim() || '';

  if (resolvedTenant.length > 0) {
    tenantId = resolvedTenant;
  }

  if (!tenantId) {
    throw new Error('Tenant id is required in request headers or path');
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
      externalHospitalId: tenant.organizationId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}

export function buildSSORequestContextFromSQS(
  event: PatientCreationEvent,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN } = getEnvConfig();
  if (!event.tenantId || event.tenantId.trim().length === 0) {
    throw new Error('tenantId is required in SQS event payload');
  }
  const tenantId = event.tenantId.trim();
  const tenant = loadTenantDetails(tenantId);
  return {
    correlationId,
    tenantId,
    serviceToken: INTERNAL_SERVICE_TOKEN ? `${INTERNAL_SERVICE_TOKEN}` : null,
    source: 'sso-integration',
    integration: {
      providerId: tenant.provider,
      subdomain: tenantId,
      externalHospitalId: tenant.organizationId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}

export function buildSSORequestContextFromTenant(
  tenant: ExternalTenant,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN } = getEnvConfig();
  if (!tenant.subdomain || tenant.subdomain.trim().length === 0) {
    throw new Error(`subdomain is required for tenant: ${tenant.tenantId}`);
  }
  return {
    correlationId,
    tenantId: tenant.tenantId,
    serviceToken: INTERNAL_SERVICE_TOKEN ? `${INTERNAL_SERVICE_TOKEN}` : null,
    source: 'sso-integration',
    integration: {
      providerId: tenant.provider,
      subdomain: tenant.subdomain,
      externalHospitalId: tenant.organizationId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}

export const buildExternalIdentity = (
  externalUserId: string,
  context: SSORequestContext,
): ExternalIdentity => {
  const subdomain = context.integration?.subdomain?.trim();
  const provider = context.integration?.providerId?.trim();
  if (!subdomain || !provider) {
    throw new Error('Context integration subdomain/provider is required');
  }
  const tenant = loadTenantDetails(subdomain);
  return {
    externalUserId: externalUserId,
    subdomain,
    provider: provider || tenant.provider,
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
      externalHospitalId: tenant.organizationId,
    },
    sourceSystem: SourceSystem.HMS,
  };
}
