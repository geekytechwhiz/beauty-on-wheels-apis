import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateOrganizationListPost } from '../validation/request.validators';
import { mapOrganizationListItem } from '../utils/organizationList.mapper';

const organizationService = new OrganizationService();

const DEFAULT_LIST_LIMIT = 40;

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
  const limit = Number.isFinite(parsedLimit) && parsedLimit! > 0 ? parsedLimit! : DEFAULT_LIST_LIMIT;

  const paginationKeyRaw = body.nextPaginationKey;
  const nextPaginationKey =
    typeof paginationKeyRaw === 'string' && paginationKeyRaw.trim().length > 0
      ? paginationKeyRaw.trim()
      : undefined;

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
