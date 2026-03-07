import { LambdaRequest, withLambdaHandler } from "@api-hub/utils";
import { CreateUserService } from "../../services/create_user";
import { assignUserRole } from "../../services/role.service";
import { UserValidationService } from "../../validation/user-validation";
import { validateCreateUser } from "../../validation/request.validators";
import { OrganizationNotFoundError } from "../../errors/user-errors";

const userService = new CreateUserService();

export const handler = withLambdaHandler(
  async (
    req: LambdaRequest<any> & {
      validatedCreateUser?: {
        userInfo: any;
        userRole: any;
        userType: any;
        organizationID: string;
        userID: string;
      };
    }
  ) => {

    const data = req.validatedCreateUser!;
    const { userInfo, userRole, userType, organizationID, userID } = data;

    const authHeader = req.context.authHeader;
    const correlationId = req.context.correlationId;
    const body = req.body ?? {};
 
    if (organizationID) {
      await UserValidationService.validateOrganization(
        organizationID,
        authHeader
      );
    }else{
      throw new OrganizationNotFoundError("organizationID");
    }

    const roleIds = UserValidationService.normalizeRoleIds(userRole);
    const primaryRoleId = roleIds[0];

    const result = await userService.createUser({
      userInfo,
      userRole,
      userType,
      userID,
      organizationID,
      correlationId,
      authHeader: authHeader ?? "",
      friendNFamily: body?.userInfo?.friendNFamily,
      assignDoctor: body?.userInfo?.assignDoctor,
    });

    if (primaryRoleId) {
      await assignUserRole(
        primaryRoleId,
        organizationID,
        result.userID,
        userInfo.name,
        userInfo.contact?.email ?? "",
        userInfo.contact?.phone ?? "",
        userInfo.profilePic,
        authHeader
      );
    }

    return {
      invitedUser: result.userID
    };
  },
  {
    validator: validateCreateUser
  }
);