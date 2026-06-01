import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { fhirOrganizationCountHandlerOptions } from '../utils/fhir-handler-options';
import { validateGetOrganizationUserCount } from '../validation/request.validators';

const userService = new UserService();

interface Params {
  organizationId?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const organizationId = req.params.organizationId ?? req.context.userContext?.organizationId ?? '';
  const { correlationId } = req.context;
  const items = await userService.getOrganizationUserCounts(
    organizationId,
    undefined,
    correlationId,
  );
  return items.map((item) => ({
    organizationID: organizationId,
    organizationName: `${String(item.roleName ?? item.definedRoleCode ?? 'role')}: ${String(item.count ?? 0)}`,
    ...item,
  }));
};

export const main = withApiHandler(
  { operation: 'getOrganizationUserCount', validator: validateGetOrganizationUserCount, fhir: fhirOrganizationCountHandlerOptions },
  handler,
);
