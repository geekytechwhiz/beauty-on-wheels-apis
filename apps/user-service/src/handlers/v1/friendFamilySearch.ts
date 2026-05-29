import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserRepository } from '../../repositories/user.repository';
import { CognitoService } from '../../services/cognito.service';
import { FriendFamilyService } from '../../services/friendFamily.service';
import { assignUserRole } from '../../services/role.service';
import { UserService } from '../../services/user.service';
import { buildCreateUserPayloadFromFnfSearch, getUserIdAndOrganizationIdFromToken } from '../../utils/helpers';
import { fhirRelatedPersonHandlerOptions } from '../../utils/fhir-handler-options';
import { validateFriendFamilySearch } from '../../validation/request.validators';

const friendFamilyService = new FriendFamilyService();
const userService = new UserService();
const userRepository = new UserRepository();

const handler = async (req: LambdaRequest<any>) => {
  const authHeader = req.context.authHeader;
  const body = (req.body ?? {}) as any;
  const fromToken = getUserIdAndOrganizationIdFromToken(authHeader);
  const organizationID = body.organizationID ?? req.context.userContext?.organizationId ?? fromToken.organizationId;
  let userID = '';
  if (fromToken.sub) {
    const region = process.env.REGION ?? process.env.AWS_REGION ?? 'us-east-1';
    const userPoolId = process.env.COGNITO_USER_POOL_ID ?? '';
    const cognitoService = new CognitoService(region, userPoolId);
    const attrs = await cognitoService.getUserAttributes(fromToken.sub);
    userID = attrs.userID ?? '';
  }
  if (!organizationID) {
    const err: any = new Error('Organization ID is required');
    err.statusCode = 400;
    err.code = 'MISSING_ORGANIZATION_ID';
    throw err;
  }
  if (!userID) {
    const err: any = new Error('User ID is required');
    err.statusCode = 400;
    err.code = 'MISSING_USER_ID';
    throw err;
  }

  const result = await friendFamilyService.searchFnf(organizationID, userID, body, authHeader);
  if (result.success && result.invitedUser && result.data) {
    return result.data;
  }

  await friendFamilyService.checkFriendFamilyLimit(userID);
  const userData = buildCreateUserPayloadFromFnfSearch(body, organizationID, userID) as any;
 
  const roleIds = Array.isArray(userData.userRole) ? userData.userRole.map((r: string) => String(r)) : [];
  if (roleIds.length > 0) {
    const rolePermissions = await userRepository
      .getRolePermissions(roleIds[0], organizationID)
      .catch(() => []);
    if (rolePermissions?.length > 0) {
      const exactMatch = rolePermissions.find((item: any) => item.SK === `ROLE#${roleIds[0]}`) || rolePermissions[0];
      const definedRoleCode = exactMatch?.definedRoleCode;
      if (definedRoleCode != null) userData.definedRoleCode = String(definedRoleCode);
    }
  }

  const correlationId = req.context.correlationId;
  const newUser = await userService.createUser(
    userData,
    userData.roleName,
    organizationID,
    userID,
    correlationId,
    authHeader,
    undefined,
    undefined,
  );

  if (roleIds.length > 0) {
    await assignUserRole(
      roleIds[0],
      organizationID,
      newUser.userID,
      body?.fullName ?? '',
      (body?.email ?? '').toString().trim(),
      (body?.phone ?? '').toString().trim(),
      '',
      authHeader,
    ).catch((error) => {
      
      throw error;
    });
  }

  const emailVal = (body?.email ?? '').toString().trim();
  const phoneVal = (body?.phone ?? '').toString().trim();
  const inviteData: Record<string, unknown> = { invitedUser: newUser.userID };
  if (emailVal.length > 0) {
    (inviteData as any).email = { isVerified: true, emailId: emailVal, userId: newUser.userID };
  }
  if (phoneVal.length > 0) {
    (inviteData as any).phone = { isVerified: true, phoneNumb: phoneVal, userId: newUser.userID };
  }
  return inviteData;
};

export const main = withApiHandler(
  {
    operation: 'friendFamilySearch',
    validator: validateFriendFamilySearch,
    fhir: fhirRelatedPersonHandlerOptions,
  },
  handler,
);
