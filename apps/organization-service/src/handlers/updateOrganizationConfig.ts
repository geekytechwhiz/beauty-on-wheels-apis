import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { updateOrganizationConfigSchema } from '../validation/organization.validation';
import { validateOrganizationIdParam } from '../validation/request.validators';

const organizationService = new OrganizationService();

interface Params {
  organizationId?: string;
  [key: string]: unknown;
}

/**
 * `PUT /organization/{organizationId}/config` — saves org config as draft, validates,
 * publishes as ACTIVE, and emits `OrgConfigPublished.v1` via EventBridge.
 */
const handler = async (req: LambdaRequest<Params>) => {
  const organizationId = req.params.organizationId as string;
  const body = req.body ?? {};
  const { correlationId } = req.context;
  const authHeader = req.event?.headers?.Authorization ?? req.event?.headers?.authorization;
  const authorizer = req.event?.requestContext?.authorizer as Record<string, any> | undefined;
  const createdBy =
    req.context?.userContext?.userId ??
    authorizer?.userId ??
    authorizer?.userID ??
    authorizer?.claims?.sub ??
    authorizer?.claims?.['custom:userID'];

  const validationResult = updateOrganizationConfigSchema.safeParse(body);
  if (!validationResult.success) {
    const err: any = new Error(validationResult.error.issues[0]?.message ?? 'Validation failed');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validationResult.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message }));
    throw err;
  }

  return organizationService.saveAndPublishOrganizationConfig(organizationId, validationResult.data, {
    correlationId,
    createdBy,
    authHeader: typeof authHeader === 'string' ? authHeader : undefined,
  });
};

export const main = withApiHandler(
  { operation: 'updateOrganizationConfig', validator: validateOrganizationIdParam },
  handler,
);
