import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { fhirOrganizationListHandlerOptions } from '../utils/fhir-handler-options';
import { validateGetLinkedOrganizations } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId?: string;
  orgType?: string;
  userId?: string;
  preferredOrgId?: string;
  limit?: number;
  nextPaginationKey?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const body = req.body ?? {};
  const { correlationId } = req.context;
  const authorizer = req.event?.requestContext?.authorizer;
  const userIdFromToken = authorizer?.userId ?? authorizer?.userID ?? authorizer?.claims?.sub ?? authorizer?.claims?.['custom:userID'];
  const organizationId = body.organizationId ?? req.params.organizationId;
  const orgType = body.orgType ?? req.params.orgType;
  const userId = body.userId ?? userIdFromToken ?? req.params.userId;
  const preferredOrgId = body.preferredOrgId ?? req.params.preferredOrgId;
  const limitRaw = body.limit ?? req.params.limit;
  const limitNum = limitRaw !== undefined && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
  const nextPaginationKey = body.nextPaginationKey ?? req.params.nextPaginationKey;

  const result = await organizationService.getLinkedOrganizations(
    organizationId,
    { orgType, preferredOrgId, limit: limitNum, nextPaginationKey },
    correlationId,
  );
  return {
    items: result.items,
    nextPaginationKey: result.nextPaginationKey ?? undefined,
  };
};

export const main = withApiHandler(
  { operation: 'getLinkedOrganizations', validator: validateGetLinkedOrganizations, fhir: fhirOrganizationListHandlerOptions },
  handler,
);
