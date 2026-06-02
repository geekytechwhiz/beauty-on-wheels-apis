import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationListPost } from '../validation/request.validators';
import { mapOrganizationListItem } from '../utils/organizationList.mapper';
import { resolveOrgListPaginationKey } from '../utils/organizationList.pagination';
import { DEFAULT_ORG_LIST_LIMIT, MAX_ORG_LIST_LIMIT } from '../utils/organizationList.constants';

const organizationService = new OrganizationService();

interface ListBody {
  organizationId?: string;
  organizationID?: string;
  status?: unknown;
  organizationType?: unknown;
  assignedPackagesName?: unknown;
  adminName?: string;
  organizationName?: string;
  country?: string;
  state?: string;
  city?: string;
  limit?: number | string;
  nextPaginationKey?: string;
  lastEvaluatedKey?: string | Record<string, unknown> | null;
}

export function toArray<T>(value?: T | T[] | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const handler = async (req: LambdaRequest<ListBody>) => {
  const body = req.body ?? {};
  const event = req.event as unknown as Record<string, unknown>;
  let organizationId = body.organizationId ?? body.organizationID ?? (event?.organizationID as string | undefined);
  if (organizationId === 'ROOT') organizationId = undefined;

  const limitRaw = body.limit;
  const parsedLimit = typeof limitRaw === 'string' ? Number(limitRaw) : typeof limitRaw === 'number' ? limitRaw : undefined;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit! > 0
      ? Math.min(parsedLimit!, MAX_ORG_LIST_LIMIT)
      : DEFAULT_ORG_LIST_LIMIT;

  const nextPaginationKey = resolveOrgListPaginationKey({
    nextPaginationKey: body.nextPaginationKey,
    lastEvaluatedKey: body.lastEvaluatedKey,
  });

  const result = await organizationService.listOrganizations({
    organizationId,
    status: toArray(body.status) as string[],
    organizationType: toArray(body.organizationType) as string[],
    adminName: body.adminName,
    organizationName: body.organizationName,
    country: body.country,
    state: body.state,
    city: body.city,
    assignedPackagesName: toArray(body.assignedPackagesName) as string[],
    limit,
    nextPaginationKey,
  });

  const cursor = result.nextPaginationKey ?? null;

  return {
    items: result.items.map(mapOrganizationListItem),
    nextPaginationKey: cursor,
    lastEvaluatedKey: cursor,
  };
};

export const main = withApiHandler({ operation: 'organizationList', validator: validateOrganizationListPost }, handler);
