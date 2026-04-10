import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { validateGetExternalTenant } from '../validation/request.validators';

interface Body {
  apiBaseUrl: string;
  providerId?: string;
}

const organizationService = new OrganizationService();

const handler = async (req: LambdaRequest<Record<string, never>>) => {
  const body = (req.body ?? {}) as Body;
  const resolved = await organizationService.getExternalTenantByApiBaseUrl(body.apiBaseUrl, body.providerId);
  (req.context as Record<string, unknown>).tenantId = resolved.tenantId;
  return resolved;
};

export const main = withLambdaHandler(handler, {
  validator: validateGetExternalTenant,
});
