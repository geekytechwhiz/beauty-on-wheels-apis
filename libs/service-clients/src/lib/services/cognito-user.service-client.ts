import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
  UserNotFoundException,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";

import { createLogger, serializeError } from "@api-hub/logger";

const logger = createLogger({ service: "cognito-service" });

export class CognitoService {

  private client: CognitoIdentityProviderClient;
  private userPoolId: string;

  constructor(region: string, userPoolId: string) {

    if (!userPoolId) {
      logger.warn({
        event: "cognito_service_init_missing_pool_id",
        message: "Cognito User Pool ID is not configured. Cognito operations will be skipped.",
      });
    }

    this.client = new CognitoIdentityProviderClient({ region });
    this.userPoolId = userPoolId;
  }

  async userExistsIdentifier(identifier: string): Promise<boolean> {

    if (!this.userPoolId) {
      logger.debug({
        event: "cognito_user_exists_skipped",
        identifier,
        message: "UserPool not configured",
      });
      return false;
    }

    try {

      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: identifier.toLowerCase(),
      });

      await this.client.send(cmd);

      logger.debug({
        event: "cognito_user_exists_found_by_username",
        identifier,
      });

      return true;

    } catch (err) {

      if (err instanceof UserNotFoundException) {

        try {

          const isEmail = identifier.includes("@");

          const filter = isEmail
            ? `email = "${identifier.toLowerCase()}"`
            : `phone_number = "${identifier}"`;

          const listCmd = new ListUsersCommand({
            UserPoolId: this.userPoolId,
            Filter: filter,
            Limit: 1,
          });

          const res = await this.client.send(listCmd);

          const found = !!(res?.Users && res.Users.length > 0);

          logger.debug({
            event: "cognito_user_exists_checked_list",
            identifier,
            found,
          });

          return found;

        } catch (err2) {

          logger.warn({
            event: "cognito_user_exists_list_error",
            identifier,
            err: serializeError(err2),
          });

          return false;
        }
      }

      logger.warn({
        event: "cognito_user_exists_error",
        identifier,
        err: serializeError(err),
      });

      return false;
    }
  }

  async userExists(email: string): Promise<boolean> {
    return this.userExistsIdentifier(email);
  }

  async getUserAttributes(
    username: string
  ): Promise<{ userID?: string; organizationID?: string }> {

    if (!this.userPoolId) {
      logger.debug({
        event: "cognito_get_user_attrs_skipped",
      });
      return {};
    }

    try {

      const cmd = new AdminGetUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      });

      const res = await this.client.send(cmd);

      const attrs = res.UserAttributes ?? [];

      const getAttr = (name: string) =>
        attrs.find((a) => a.Name === name)?.Value;

      return {
        userID: getAttr("custom:userID") ?? undefined,
        organizationID: getAttr("custom:organizationID") ?? undefined,
      };

    } catch (err) {

      if (err instanceof UserNotFoundException) {
        logger.debug({
          event: "cognito_get_user_attrs_not_found",
          username,
        });
        return {};
      }

      logger.warn({
        event: "cognito_get_user_attrs_error",
        username,
        err: serializeError(err),
      });

      return {};
    }
  }

  async createUser(
    identifier: string,
    options?: {
      email?: string;
      phoneNumber?: string;
      customAttributes?: {
        userType?: string;
        userID?: string;
        organizationID?: string;
        role?: string;
        roleName?: string;
        permissions?: string;
      };
    }
  ): Promise<void> {

    if (!this.userPoolId) {
      throw new Error("Cognito User Pool ID is not configured");
    }

    try {

      const attrs: Array<{ Name: string; Value: string }> = [];

      const isEmail = identifier.includes("@");

      if (options?.email) {
        attrs.push({ Name: "email", Value: options.email });
        attrs.push({ Name: "email_verified", Value: "true" });
      }

      if (options?.phoneNumber) {
        attrs.push({ Name: "phone_number", Value: options.phoneNumber });
        attrs.push({ Name: "phone_number_verified", Value: "true" });
      }

      if (attrs.length === 0 && isEmail) {
        attrs.push({ Name: "email", Value: identifier });
        attrs.push({ Name: "email_verified", Value: "true" });
      }

      if (options?.customAttributes) {

        const custom = options.customAttributes;

        if (custom.userType)
          attrs.push({ Name: "custom:userType", Value: custom.userType });

        if (custom.userID)
          attrs.push({ Name: "custom:userID", Value: custom.userID });

        if (custom.organizationID)
          attrs.push({ Name: "custom:organizationID", Value: custom.organizationID });

        if (custom.role)
          attrs.push({ Name: "custom:role", Value: custom.role });

        if (custom.roleName)
          attrs.push({ Name: "custom:roleName", Value: custom.roleName });

        if (custom.permissions)
          attrs.push({ Name: "custom:permissions", Value: custom.permissions });

        attrs.push({
          Name: "custom:src",
          Value: isEmail ? identifier.toLowerCase() : identifier,
        });
      }

      const username = identifier.toLowerCase();

      const generatePassword = () =>
        `Comm@n12${Math.random().toString(36).slice(-8)}`;

      const tempPassword = generatePassword();

      const createCmd = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        UserAttributes: attrs,
        MessageAction: "SUPPRESS",
        TemporaryPassword: tempPassword,
      });

      await this.client.send(createCmd);

      const setPasswordCmd = new AdminSetUserPasswordCommand({
        UserPoolId: this.userPoolId,
        Username: username,
        Password: generatePassword(),
        Permanent: true,
      });

      await this.client.send(setPasswordCmd);

      logger.info({
        event: "cognito_user_created",
        identifier,
        userPoolId: this.userPoolId,
      });

    } catch (err) {

      if (err instanceof UsernameExistsException) {

        logger.info({
          event: "cognito_user_already_exists",
          identifier,
        });

        return;
      }

      logger.error({
        event: "cognito_create_user_error",
        identifier,
        err: serializeError(err),
      });

      throw err;
    }
  }

  async deleteUser(username: string): Promise<void> {

    if (!this.userPoolId) {
      logger.warn({
        event: "cognito_delete_user_skipped",
        username,
      });
      return;
    }

    try {

      const cmd = new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: username,
      });

      await this.client.send(cmd);

      logger.info({
        event: "cognito_user_deleted",
        username,
      });

    } catch (err) {

      if (err instanceof UserNotFoundException) {

        logger.debug({
          event: "cognito_delete_user_not_found",
          username,
        });

        return;
      }

      logger.error({
        event: "cognito_delete_user_failed",
        username,
        err: serializeError(err),
      });

      throw err;
    }
  }
}