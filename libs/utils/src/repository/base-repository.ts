import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  BatchGetCommand,
  QueryCommandInput,
  UpdateCommandInput,
  TransactWriteCommand,

  type GetCommandOutput,
  type PutCommandOutput,
  type UpdateCommandOutput,
  type DeleteCommandOutput,
  type QueryCommandOutput,
  type BatchGetCommandOutput,
  type TransactWriteCommandInput,
  type TransactWriteCommandOutput,
} from "@aws-sdk/lib-dynamodb";


import { ddbDocClient } from "../configs/db.config";
import { sendDoc } from "../configs/dynamodb-send";
import {
  createLogger,
  createChildLogger,
} from "@api-hub/logger";

const baseLogger = createLogger({
  service: "dynamo-repository",
  redactPII: true,
});

export abstract class BaseRepository {

  private readonly logger = createChildLogger(baseLogger, {
    service: this.constructor.name,
  });

  protected async get<T>(table: string, key: any): Promise<T | null> {

    this.logger.debug({ event: "dynamodb_get", table, key });

    const result = await sendDoc<GetCommandOutput>(
      ddbDocClient,
      new GetCommand({
        TableName: table,
        Key: key,
      })
    );

    return (result.Item as T) || null;

  }

  protected async transactWrite(
    params: TransactWriteCommandInput
  ): Promise<void> {
  
    this.logger.debug({
      event: 'dynamodb_transact_write',
      tables: params.TransactItems?.length,
    });
  
    await sendDoc<TransactWriteCommandOutput>(
      ddbDocClient,
      new TransactWriteCommand(params)
    );
  
  }

  protected async put<T>(
    table: string,
    item: T,
    condition?: string
  ): Promise<void> {

    this.logger.debug({ event: "dynamodb_put", table });

    await sendDoc<PutCommandOutput>(
      ddbDocClient,
      new PutCommand({
        TableName: table,
        Item: item as Record<string, any>,
        ConditionExpression: condition,
      })
    );

  }

  protected async update(params: UpdateCommandInput): Promise<void> {

    this.logger.debug({
      event: "dynamodb_update",
      table: params?.TableName,
      key: params?.Key,
    });

    await sendDoc<UpdateCommandOutput>(
      ddbDocClient,
      new UpdateCommand(params)
    );

  }

  protected async delete(
    table: string,
    key: any
  ): Promise<void> {

    this.logger.debug({ event: "dynamodb_delete", table, key });

    await sendDoc<DeleteCommandOutput>(
      ddbDocClient,
      new DeleteCommand({
        TableName: table,
        Key: key,
      })
    );

  }

  protected async query<T>(
    params: QueryCommandInput
  ): Promise<T[]> {

    this.logger.debug({
      event: "dynamodb_query",
      table: params?.TableName,
      index: params?.IndexName,
    });

    const result = await sendDoc<QueryCommandOutput>(
      ddbDocClient,
      new QueryCommand(params)
    );

    return (result.Items as T[]) || [];

  }

  protected async queryAll<T>(
    params: QueryCommandInput
  ): Promise<T[]> {

    const items: T[] = [];
    let lastKey;

    do {

      const result: QueryCommandOutput = await sendDoc<QueryCommandOutput>(
        ddbDocClient,
        new QueryCommand({
          ...params,
          ExclusiveStartKey: lastKey as any,
        })
      );

      if (result.Items) {
        items.push(...(result.Items as T[]));
      }

      lastKey = result.LastEvaluatedKey;

    } while (lastKey);

    return items;

  }

  protected async queryOne<T>(
    params: QueryCommandInput
  ): Promise<T | null> {

    const items = await this.query<T>({
      ...params,
      Limit: 1,
    });

    return items.length ? items[0] : null;

  }

  protected async batchGet<T>(
    params: any
  ): Promise<T[]> {

    const result = await sendDoc<BatchGetCommandOutput>(
      ddbDocClient,
      new BatchGetCommand(params)
    );

    return result.Responses
      ? (Object.values(result.Responses).flat() as T[])
      : [];

  }

}