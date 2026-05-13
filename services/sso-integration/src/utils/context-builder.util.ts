import { APIGatewayProxyevent: any, Scheduledevent: any, SQSEvent } from 'aws-lambda';
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
    | PatientCreationevent: any,
  correlationId: string,
): SSORequestContext {
  const { INTERNAL_SERVICE_TOKEN } = getEnvConfig();
  let tenantId: string | null = null;
  let serviceToken: string | null = null;

  const eventLike = event as {
    headers?: Record<string, string | undefined>;
    pathParameters?: { tenantId?: string; tenant?: string };
    queryStringParameters?: {
      tenantId?: string;
      tenant?: string;
      subdomain?: string;
    };
    body?: string | null;
  };

  const headers: Record<string, string | undefined> =
    eventLike?.headers && typeof eventLike.headers === 'object'
      ? eventLike.headers
      : {};

  const getHeaderValue = (
    source: Record<string, string | undefined>,
    headerName: string,
  ): string | undefined => {
    const directValue = source[headerName];
    if (typeof directValue === 'string') {
      return directValue;
    }

    const normalizedHeaderName = headerName.toLowerCase();
    const matchedKey = Object.keys(source).find(
      (key) => key.toLowerCase() === normalizedHeaderName,
    );

    return matchedKey ? source[matchedKey] : undefined;
  };

  let bodyTenant: string | undefined;
  if (typeof eventLike?.body === 'string' && eventLike.body.trim().length > 0) {
    try {
      const parsedBody = JSON.parse(eventLike.body) as {
        tenantId?: string;
        tenant?: string;
        subdomain?: string;
      };
      bodyTenant = parsedBody.tenantId || parsedBody.tenant || parsedBody.subdomain;
    } catch {
      bodyTenant = undefined;
    }
  }

  // Prefer explicit tenantId from headers/path/query/body when provided.
  const headerTenant =
    getHeaderValue(headers, 'x-tenant-id') ||
    getHeaderValue(headers, 'x-tenantid') ||
    getHeaderValue(headers, 'x-tenant') ||
    getHeaderValue(headers, 'tenant-id') ||
    getHeaderValue(headers, 'tenantid');

  const pathTenant =
    eventLike?.pathParameters?.tenantId ||
    eventLike?.pathParameters?.tenant;

  const queryTenant =
    eventLike?.queryStringParameters?.tenantId ||
    eventLike?.queryStringParameters?.tenant ||
    eventLike?.queryStringParameters?.subdomain;

  const resolvedTenant =
    (headerTenant || pathTenant || queryTenant || bodyTenant)?.trim() || '';

  if (resolvedTenant.length > 0) {
    tenantId = resolvedTenant;
  }

  if (!tenantId) {
    throw new Error('Tenant id is required in request headers, path, query, or body');
  }

  serviceToken = getHeaderValue(headers, 'authorization') || null;

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
  event: PatientCreationevent: any,
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
