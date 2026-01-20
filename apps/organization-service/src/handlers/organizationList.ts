import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'organizationList_received' });

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const query = event.queryStringParameters ?? {};

    let organizationId = body?.organizationId ?? (event as { organizationID?: string })?.organizationID ?? query.organizationId;
    if (organizationId === 'ROOT') {
      organizationId = undefined;
    }

    const statusRaw = body?.status ?? query.status;
    const organizationTypeRaw = body?.organizationType ?? query.organizationType;
    const assignedPackagesNameRaw = body?.assignedPackagesName ?? query.assignedPackagesName;

    const toArray = (value: unknown): string[] | undefined => {
      if (!value) return undefined;
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
      if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
      return undefined;
    };

    const limitRaw = body?.limit ?? query.limit;
    const limit = typeof limitRaw === 'string' ? Number(limitRaw) : typeof limitRaw === 'number' ? limitRaw : undefined;

    const nextPaginationKey = body?.nextPaginationKey ?? query.nextPaginationKey;

    const result = await organizationService.listOrganizations({
      organizationId,
      status: toArray(statusRaw),
      organizationType: toArray(organizationTypeRaw),
      adminName: body?.adminName ?? query.adminName,
      organizationName: body?.organizationName ?? query.organizationName,
      country: body?.country ?? query.country,
      state: body?.state ?? query.state,
      city: body?.city ?? query.city,
      assignedPackagesName: toArray(assignedPackagesNameRaw),
      limit: Number.isFinite(limit) ? limit : undefined,
      nextPaginationKey: typeof nextPaginationKey === 'string' ? nextPaginationKey : undefined,
    });

    const organizations = result.items.map((item) => {
      const cleaned = { ...item } as Record<string, unknown>;
      delete cleaned.traceId;
      if (cleaned.organizationInfo && typeof cleaned.organizationInfo === 'object') {
        const orgInfo = cleaned.organizationInfo as Record<string, unknown>;
        if (orgInfo.organizationName && !orgInfo.name) {
          orgInfo.name = orgInfo.organizationName;
        }
      }
      return cleaned;
    });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/list', 200, duration, correlationId);
    return ApiResponse.ok(
      {
        items: organizations,
        ...(result.nextPaginationKey ? { nextPaginationKey: result.nextPaginationKey } : {}),
      },
      { title: 'Success', description: 'Organizations retrieved successfully' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'organizationList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/organization/list', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to list organizations', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'LIST_ORGANIZATIONS_FAILED' },
    );
  }
};
