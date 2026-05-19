import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { updateOrganizationMetadataSchema } from '../validation/organization.validation';
import { validateOrganizationIdParam, validateUpdateOrganizationMetadata } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { organizationId } = req.params;
  const body = req.body ?? {};
  const { correlationId } = req.context;
  const result = updateOrganizationMetadataSchema.safeParse(body);
  if (!result.success) {
    const err: any = new Error(result.error.issues[0]?.message ?? 'Validation failed');
    err.statusCode = 422;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  const { metadata, updatedBy, version } = result.data;
  return organizationService.updateOrganizationMetadata(organizationId, metadata, correlationId, updatedBy, version);
};

export const main = withApiHandler({ operation: 'updateOrganizationMetadata', validator: (req: any) => {
    validateOrganizationIdParam(req);
    validateUpdateOrganizationMetadata(req);
  },
}, handler);
