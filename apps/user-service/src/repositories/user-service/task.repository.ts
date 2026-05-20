import { QueryCommand, type QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../utils/db.config";
import { sendDoc } from "../../utils/dynamodb-send";
import { createLogger, createChildLogger, serializeError } from '@api-hub/observability';

const baseLogger = createLogger({ service: "user-service", redactPII: true });

const TASKS_TABLE = process.env.TASKS_TABLE || "";

export class TaskRepository {

  /**
   * Checks if a user has pending tasks
   * Returns true if all tasks are completed
   */
  async checkCompletedTasks(userId: string): Promise<boolean> {
    const logger = createChildLogger(baseLogger, { userId });

    if (!TASKS_TABLE) {
      logger.warn({ event: "tasks_table_missing" });
      return true;
    }

    try {
      const params = {
        TableName: TASKS_TABLE,
        IndexName: "pk-sk1-index",
        KeyConditionExpression: "#pk = :pk and #sk = :sk",
        ExpressionAttributeNames: {
          "#pk": "pk",
          "#sk": "sk1",
        },
        ExpressionAttributeValues: {
          ":pk": `TASK#${userId}`,
          ":sk": "PENDING",
        },
      };

      const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));

      const hasPendingTasks = (result.Count ?? 0) > 0;

      logger.info({
        event: "check_completed_tasks",
        hasPendingTasks,
      });

      return !hasPendingTasks;

    } catch (err) {
      logger.error({
        event: "check_completed_tasks_error",
        err: serializeError(err),
      });

      return true;
    }
  }
}