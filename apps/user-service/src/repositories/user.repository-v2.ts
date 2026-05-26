import { BaseRepository, ConditionalWriteConflictError } from "@api-hub/utils";
import { UserRequestModel } from "../models/user/UserDTO";
import { UserAlreadyExistsError } from "../utils/errors"; 

import {
  createLogger,
  createChildLogger,
  serializeError
} from '@api-hub/observability';
import { UserKeys } from "../domain/user.keys";

const baseLogger = createLogger({
  service: "user-service",
  redactPII: true
});

const USER_TABLE_NAME = process.env.USER_TABLE || "";

export class UserRepositoryV2 extends BaseRepository {

  async createUser(user: UserRequestModel): Promise<void> {

    const item = {
      ...user,
      pk: UserKeys.orgPk(user.organizationID),
      sk: UserKeys.userSk(user.userID),
    };

    try {

      await this.put(
        USER_TABLE_NAME,
        item,
        "attribute_not_exists(pk) AND attribute_not_exists(sk)"
      );

      const logger = createChildLogger(baseLogger, {
        userId: user.userID
      });

      logger.info({ event: "user_created" });

    } catch (err: unknown) {

      const code = (err as { name?: string })?.name;
      const logger = createChildLogger(baseLogger, {
        userId: user.userID
      });

      if (
        err instanceof ConditionalWriteConflictError ||
        code === "ConditionalCheckFailedException"
      ) {
        throw new UserAlreadyExistsError(user.userID);
      }

      logger.error({
        event: "user_create_error",
        err: serializeError(err)
      });

      throw err;

    }

  }

  async assignUserToOrganization(user: UserRequestModel): Promise<void> {

    const item = {
      ...user,
      pk: UserKeys.userPk(user.userID),
      sk: UserKeys.orgSk(user.organizationID)
    };

    await this.put(USER_TABLE_NAME, item);

  }

  async getUser(
    userId: string,
    organizationId?: string
  ): Promise<UserRequestModel | null> {

    try {

      if (organizationId) {

        const result = await this.get<UserRequestModel>(
          USER_TABLE_NAME,
          {
            pk: UserKeys.orgPk(organizationId),
            sk: UserKeys.userSk(userId)
          }
        );

        return result;

      }

      const result = await this.query<UserRequestModel>({
        TableName: USER_TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk,:sk)",
        ExpressionAttributeValues: {
          ":pk": UserKeys.userPk(userId),
          ":sk": "ORG#"
        },
        Limit: 1
      });

      return result?.[0] || null;

    } catch (err) {

      const logger = createChildLogger(baseLogger, { userId });

      logger.error({
        event: "getUser_error",
        err: serializeError(err)
      });

      throw err;

    }

  }

  async updateUser(
    userId: string,
    organizationId: string,
    updates: Partial<UserRequestModel>
  ): Promise<void> {

    const updateParts: string[] = ["modifiedDate = :modifiedDate"];

    const exprNames: Record<string, string> = {};

    const exprValues: Record<string, unknown> = {
      ":modifiedDate": Date.now()
    };

    for (const [key, value] of Object.entries(updates)) {

      if (value === undefined) continue;

      const attrName = `#${key}`;
      const attrValue = `:${key}`;

      updateParts.push(`${attrName} = ${attrValue}`);

      exprNames[attrName] = key;
      exprValues[attrValue] = value;

    }

    await this.update({
      TableName: USER_TABLE_NAME,
      Key: {
        pk: UserKeys.orgPk(organizationId),
        sk: UserKeys.userSk(userId)
      },
      UpdateExpression: `SET ${updateParts.join(", ")}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues
    });

  }

}