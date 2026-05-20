import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateLinkUnlinkOrganization } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Body {
  fromOrg: string;
  toOrg: string;
  action: 'LINK' | 'UNLINK';
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body ?? {};
  const { fromOrg, toOrg, action } = body;
  const actionNormalized = action.toUpperCase() as 'LINK' | 'UNLINK';
  const userId = req.context.user?.userId ?? '';
  const userType = req.event?.requestContext?.authorizer?.userType as string | undefined;
  const { correlationId, authHeader } = req.context;

  await organizationService.linkUnlinkOrganizations(
    fromOrg,
    toOrg,
    actionNormalized,
    userId,
    userType,
    correlationId,
  );
  return { message: actionNormalized === 'LINK' ? 'Org linked successfully' : 'Org unlinked successfully' };
};

export const main = withApiHandler({ operation: 'linkUnlinkOrganization', validator: validateLinkUnlinkOrganization }, handler);
