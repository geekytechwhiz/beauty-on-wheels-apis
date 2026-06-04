import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateGetLinkedOrganizations } from '../validation/request.validators';

const organizationService = new OrganizationService();
 
const handler = async (req: LambdaRequest) => {
  const body = req.body ?? {};
  const { correlationId } = req.context;
  const organizationId = body.organizationId ?? req.params.organizationId;
  const orgType = body.orgType ?? req.params.orgType; 
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

export const main = withApiHandler({ operation: 'getLinkedOrganizations', validator: validateGetLinkedOrganizations }, handler);
