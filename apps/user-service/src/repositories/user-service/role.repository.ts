import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../utils/db.config";
import { createLogger, createChildLogger, serializeError } from "@api-hub/logger";

const baseLogger = createLogger({ service: "user-service", redactPII: true });

const ROLES_TABLE = process.env.ROLES_TABLE || "";

export class RoleRepository {

  /**
   * Get role permissions
   */
  async getRolePermissions(
    roleId: string,
    organizationId: string
  ): Promise<any[]> {

    const logger = createChildLogger(baseLogger, { roleId, organizationId });

    if (!ROLES_TABLE) {
      logger.warn({ event: "roles_table_missing" });
      return [];
    }

    try {
      const params = {
        TableName: ROLES_TABLE,
        KeyConditionExpression: "#PK = :PK AND begins_with(#SK, :SK)",
        ExpressionAttributeNames: {
          "#PK": "PK",
          "#SK": "SK",
        },
        ExpressionAttributeValues: {
          ":PK": `ORG#${organizationId}`,
          ":SK": `ROLE#${roleId}`,
        },
      };

      const result = await docClient.send(new QueryCommand(params));

      logger.info({
        event: "role_permissions_fetched",
        count: result.Items?.length || 0,
      });

      return result.Items ?? [];

    } catch (err) {

      const name = (err as any)?.name;
      const message = (err as any)?.message || "";

      if (
        name === "ValidationException" &&
        (message.includes("PK") || message.includes("SK"))
      ) {
        try {

          const fallbackParams = {
            TableName: ROLES_TABLE,
            KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :sk)",
            ExpressionAttributeNames: {
              "#pk": "pk",
              "#sk": "sk",
            },
            ExpressionAttributeValues: {
              ":pk": `ORG#${organizationId}`,
              ":sk": `ROLE#${roleId}`,
            },
          };

          const fallbackResult = await docClient.send(
            new QueryCommand(fallbackParams)
          );

          return fallbackResult.Items ?? [];

        } catch (fallbackErr) {

          logger.error({
            event: "role_permissions_fallback_error",
            err: serializeError(fallbackErr),
          });

          return [];
        }
      }

      logger.error({
        event: "role_permissions_error",
        err: serializeError(err),
      });

      return [];
    }
  }

  /**
   * Get role metadata
   */
  async getRoleDetails(
    organizationId: string,
    roleId: string
  ): Promise<any[]> {

    const logger = createChildLogger(baseLogger, { organizationId, roleId });

    if (!ROLES_TABLE) {
      logger.warn({ event: "roles_table_missing" });
      return [];
    }

    try {
      const params = {
        TableName: ROLES_TABLE,
        KeyConditionExpression: "#PK = :PK AND begins_with(#SK, :SK)",
        FilterExpression:
          "(attribute_not_exists(deleteFlag) OR #deleteFlag <> :deleteFlag) AND (attribute_not_exists(isActive) OR #active = :active)",
        ExpressionAttributeNames: {
          "#PK": "PK",
          "#SK": "SK",
          "#deleteFlag": "deleteFlag",
          "#active": "isActive",
        },
        ExpressionAttributeValues: {
          ":PK": `ORG#${organizationId}`,
          ":SK": `ROLE#${roleId}`,
          ":deleteFlag": "1",
          ":active": true,
        },
      };

      const result = await docClient.send(new QueryCommand(params));

      return result.Items ?? [];

    } catch (err) {

      logger.error({
        event: "get_role_details_error",
        err: serializeError(err),
      });

      return [];
    }
  }
}