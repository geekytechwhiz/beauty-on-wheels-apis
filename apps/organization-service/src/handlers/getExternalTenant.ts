import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateGetExternalTenant } from '../validation/request.validators';

interface Body {
  provider: string;
  apiBaseUrl?: string;
}

const organizationService = new OrganizationService();

const handler = async (req: LambdaRequest<Record<string, never>>) => {
  const body = (req.body ?? {}) as Body;
  const resolved = await organizationService.getExternalTenants({
    provider: body.provider,
    apiBaseUrl: body.apiBaseUrl,
  });
  if (resolved.items.length === 1) {
    (req.context as Record<string, unknown>).tenantId = resolved.items[0].tenantId;
  }
  return resolved;
};

export const main = withLambdaHandler(handler, {
  validator: validateGetExternalTenant,
});
