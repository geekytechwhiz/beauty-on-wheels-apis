import axios from 'axios';
import { createLogger, createChildLogger } from '@api-hub/logger';
import { OrganizationRepository } from '../repositories/organization.repository';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

/** Minimal shape from Organization API for existence/status checks (e.g. create user validation). */
export interface OrganizationApiPayload {
  organizationID?: string;
  name?: string;
  status?: string;
  [key: string]: unknown;
}

export interface GetOrganizationOptions {
  minimal?: boolean;
}

/**
 * Fetches organization details via Organization service HTTP API.
 * Use for service-to-service checks (e.g. create user validation) so organization remains source of truth.
 * Optional authHeader is forwarded for downstream authorization.
 */
/**
 * Fetches organization details directly from DynamoDB (organization-table).
 * Use this in stream/event handlers that have no auth token available.
 * Requires the Lambda IAM role to have read access to the organization table
 * and ORGANIZATION_TABLE env var to be set.
 */
export async function getOrganizationFromDynamo(
  organizationId: string,
): Promise<OrganizationApiPayload | null> {
  const logger = createChildLogger(baseLogger, { organizationId });
  logger.info({ event: 'getOrganizationFromDynamo_start', organizationId });
  try {
    const repo = new OrganizationRepository();
    const item = await repo.getOrganizationFromDB(organizationId);
    if (!item) {
      logger.warn({ event: 'getOrganizationFromDynamo_not_found', organizationId });
      return null;
    }
    logger.info({ event: 'getOrganizationFromDynamo_success', organizationId });
    return item as OrganizationApiPayload;
  } catch (err) {
    logger.error({
      event: 'getOrganizationFromDynamo_error',
      organizationId,
      err: err instanceof Error ? { message: err.message, name: err.name } : err,
    });
    return null;
  }
}

export async function getOrganization(
  organizationId: string,
  authHeader?: string,
  options?: GetOrganizationOptions,
): Promise<OrganizationApiPayload | null> {
  const apiBaseUrl = process.env.ORGANIZATION_API_URL;
  const logger = createChildLogger(baseLogger, { organizationId });
  logger.info({ event: 'Fetching organization details via API', organizationId });

  if (!apiBaseUrl) {
    logger.error({ event: 'Organization API URL not configured', organizationId });
    return null;
  }

  try {
    const baseUrl = `${apiBaseUrl.replace(/\/$/, '')}/organization/${organizationId}`;
    const url = options?.minimal ? `${baseUrl}?view=minimal` : baseUrl;
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });
    const payload = response.data?.data ?? response.data ?? null;
    logger.info({
      event: 'Organization API response',
      status: response.status,
      organizationId,
      hasData: payload !== null,
    });
    return payload as OrganizationApiPayload | null;
  } catch (err) {
    const error = err as { response?: { status: number }; message?: string };
    const status = error?.response?.status;
    logger.error({
      event: 'Error fetching organization details',
      err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
      status,
      organizationId,
    });
    return null;
  }
}
