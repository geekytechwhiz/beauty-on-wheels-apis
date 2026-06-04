import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { RoleRepository } from '../repositories/role.repository';
import { generateOrganizationId } from '../utils/organizationPayload';
import { validateCreateOrganization } from '../validation/request.validators';

const organizationService = new OrganizationService();
const roleRepository = new RoleRepository();

const handler = async (req: LambdaRequest) => {
  const validatedData = (req as any).validatedCreateBody;
  const creatorId =
    req.context?.userContext?.userId ??
    req.event?.requestContext?.authorizer?.userId ??
    req.event?.requestContext?.authorizer?.userID ??
    req.event?.requestContext?.authorizer?.claims?.sub ??
    req.event?.requestContext?.authorizer?.claims?.['custom:userID'];
  const organizationId = validatedData.organizationId || generateOrganizationId();
  const payload = {
    ...validatedData,
    organizationId,
    createdBy: creatorId,
  };
  const { correlationId, authHeader } = req.context;

  const rolesCreated = await roleRepository.createDefaultRoles(organizationId, authHeader);
  if (!rolesCreated) {
    const err: any = new Error('Failed to create default roles');
    err.statusCode = 500;
    err.code = 'CREATE_DEFAULT_ROLES_FAILED';
    throw err;
  }

  const organization = await organizationService.createOrganization(payload, correlationId);
  return {
    newOrganizationID: organization.organizationId,
    hospitalImage: organization.hospitalImage,
  };
};

export const main = withApiHandler({ operation: 'createOrganization', validator: validateCreateOrganization }, handler);
