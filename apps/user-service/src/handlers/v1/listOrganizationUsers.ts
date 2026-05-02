import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../../services/user.service';
import { validateOrganizationIdParam } from '../../validation/request.validators';

const userService = new UserService();

interface Params {
  organizationId: string;
  limit?: string;
  offset?: string;
  page?: string;
  pageSize?: string;
  pageIndex?: string;
  status?: string;
  userType?: string;
  specialty?: string;
  search?: string;
  q?: string;
  sortBy?: string;
  sortOrder?: string;
  order?: string;
}

const MAX_LIMIT = 100;

function parseNumber(value?: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const handler = async (req: LambdaRequest<Params>) => {
  const organizationId = req.params.organizationId ?? req.context.userContext?.organizationId;
  const qp = req.params;
  const rawLimit = qp.limit ?? qp.pageSize;
  const rawOffset = qp.offset ?? qp.page ?? qp.pageIndex;
  let limit: number | undefined;
  let offset = 0;
  let sortBy: 'createdDate' | 'fullName' | 'firstName' | 'lastName' | 'emailAddress' | undefined;
  let sortOrder: 'asc' | 'desc' | undefined;

  if (rawLimit !== undefined) {
    const parsed = parseNumber(rawLimit);
    if (!parsed || parsed <= 0) {
      const err: any = new Error('limit must be a positive number');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }
    limit = Math.min(parsed, MAX_LIMIT);
  }
  if (rawOffset !== undefined) {
    const parsed = parseNumber(rawOffset);
    if (parsed === undefined || parsed < 0) {
      const err: any = new Error('offset / page must be a non-negative number');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }
    offset = parsed;
  }
  const allowedSortBy = ['createdDate', 'fullName', 'firstName', 'lastName', 'emailAddress'] as const;
  if (qp.sortBy && !allowedSortBy.includes(qp.sortBy as any)) {
    const err: any = new Error(`sortBy must be one of ${allowedSortBy.join(', ')}`);
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }
  if (qp.sortBy) sortBy = qp.sortBy as any;
  const rawSortOrder = qp.sortOrder ?? qp.order;
  if (rawSortOrder) {
    const normalized = rawSortOrder.toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      const err: any = new Error('sortOrder must be "asc" or "desc"');
      err.statusCode = 400;
      err.code = 'BAD_REQUEST';
      throw err;
    }
    sortOrder = normalized as 'asc' | 'desc';
  }

  return userService.listOrganizationUsers(organizationId, {
    limit,
    offset,
    status: qp.status || undefined,
    userType: qp.userType || undefined,
    specialty: qp.specialty || undefined,
    search: qp.search ?? qp.q ?? undefined,
    sortBy,
    sortOrder,
  });
};

export const main =   withApiHandler(
          {
            operation: 'listOrganizationUsers',
            validator: (req) => validateOrganizationIdParam(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
