import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { V2UserListService } from '../../services/v2-user-list.service';
import { validateV2UserList } from '../../validation/request.validators';
import type { V2UserListInput } from '../../validation/v2-user-list.validation';

const v2UserListService = new V2UserListService();

const handler = async (
  req: LambdaRequest<any> & { validatedV2UserList?: V2UserListInput }
) => {
  const { validatedV2UserList } = req;
  const { organizationId, context: userListContext, filters, pagination, sort } = validatedV2UserList!;
  const { userContext, authHeader, correlationId, logger } = req.context;

  const authUserId = userContext?.userId ?? undefined;

  logger?.info({
    event: 'v2_user_list_params',
    organizationId,
    context: userListContext,
    hasFilters: !!filters,
    hasPagination: !!pagination,
    hasSort: !!sort,
  });

  const normalizedFilters = {
    ...filters,
    userTypes: [
      ...new Set(
        (filters?.userTypes ?? []).map((t) =>
          ['patient', 'patients', 'PATIENT'].includes(String(t?.toLowerCase?.() ?? t))
            ? 'USER'
            : t
        )
      ),
    ],
  };

  const result = await v2UserListService.listUsers({
    organizationId,
    context: userListContext,
    filters: normalizedFilters,
    pagination: {
      limit: pagination?.limit,
      cursor: pagination?.cursor ?? null,
    },
    sort: {
      field: sort?.field ?? 'createdDate',
      order: sort?.order ?? 'DESC',
    },
    requestId: correlationId,
    authUserId,
    authHeader: authHeader ?? undefined,
  });

  logger?.info({
    event: 'v2_user_list_success',
    count: result.data?.items?.length ?? 0,
    hasNextCursor: !!result.meta?.nextCursor,
  });

  return result;
};

export const main =   withApiHandler(
          {
            operation: 'v2UserList',
            validator: (req) => validateV2UserList(req as any),
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await (handler as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
