import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  QueryCommandInput,
  type GetCommandOutput,
  type PutCommandOutput,
  type UpdateCommandOutput,
  type DeleteCommandOutput,
  type QueryCommandOutput,
  BatchGetCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../configs/db.config';
import { sendDoc } from '../configs/dynamodb-send';
import { BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'dynamo-repository', redactPII: true });

export abstract class DynamoRepository {
  private readonly logger = createChildLogger(baseLogger, { service: this.constructor.name });

  protected async get(table: string, key: any) {
    this.logger.debug({ event: 'dynamodb_get', table, key });

    const result = await sendDoc<GetCommandOutput>(ddbDocClient,
      new GetCommand({
        TableName: table,
        Key: key,
      }),
    );

    return result.Item || null;
  } 
  
  protected async put(table: string, item: any, condition?: string) {
    this.logger.debug({ event: 'dynamodb_put', table });

    await sendDoc<PutCommandOutput>(
      ddbDocClient,
      new PutCommand({
        TableName: table,
        Item: item,
        ConditionExpression: condition,
      }),
    );
  }

  protected async update(params: any) {
    this.logger.debug({ event: 'dynamodb_update', table: params?.TableName, key: params?.Key });

    await sendDoc<UpdateCommandOutput>(ddbDocClient, new UpdateCommand(params));
  }

  protected async delete(table: string, key: any) {
    this.logger.debug({ event: 'dynamodb_delete', table, key });

    await sendDoc<DeleteCommandOutput>(ddbDocClient,
      new DeleteCommand({
        TableName: table,
        Key: key,
      }),
    );
  }

  protected async query<T>(params: QueryCommandInput): Promise<T[]> {
    this.logger.debug({ event: 'dynamodb_query', table: params?.TableName, index: params?.IndexName, keyCondition: params?.KeyConditionExpression });

    const result = await sendDoc<QueryCommandOutput>(
      ddbDocClient,
      new QueryCommand(params),
    );
  
    return (result.Items as T[]) || [];
  }

  protected async queryAll<T>(params: QueryCommandInput): Promise<T[]> {
    const items: T[] = [];
    let lastKey;

    this.logger.debug({ event: 'dynamodb_query_all_start', table: params?.TableName, index: params?.IndexName, keyCondition: params?.KeyConditionExpression });
  
    do {
      const result: QueryCommandOutput = await sendDoc<QueryCommandOutput>(
        ddbDocClient,
        new QueryCommand({
          ...params,
          ExclusiveStartKey: lastKey as any,
        }),
      );

      if (result.Items) items.push(...(result.Items as T[]));
      lastKey = result.LastEvaluatedKey;

      this.logger.debug({ event: 'dynamodb_query_all_page', table: params?.TableName, index: params?.IndexName, keyCondition: params?.KeyConditionExpression, count: result.Items?.length || 0, hasMore: !!lastKey });

    } while (lastKey);

    return items;
  }

  protected async batchGet<T>(params: any): Promise<T[]> {
    this.logger.debug({ event: 'dynamodb_batch_get', tables: Object.keys(params?.RequestItems || {}) });

    const result = await sendDoc<BatchGetCommandOutput>(
      ddbDocClient,
      new BatchGetCommand(params)
    );

    return result.Responses ? Object.values(result.Responses).flat() as T[] : [];
  }
}