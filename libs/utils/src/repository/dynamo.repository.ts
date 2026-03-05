import {
    GetCommand,
    PutCommand,
    UpdateCommand,
    QueryCommand,
    DeleteCommand,
    QueryCommandInput
  } from "@aws-sdk/lib-dynamodb";
  
  import { ddbDocClient } from "../configs/db.config";
  
  export abstract class DynamoRepository {
  
    protected async get(table: string, key: any) {
      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: table,
          Key: key
        })
      );
  
      return result.Item || null;
    }
  
    protected async put(table: string, item: any) {
      await ddbDocClient.send(
        new PutCommand({
          TableName: table,
          Item: item
        })
      );
    }
  
    protected async update(params: any) {
      await ddbDocClient.send(new UpdateCommand(params));
    }
  
    protected async delete(table: string, key: any) {
      await ddbDocClient.send(
        new DeleteCommand({
          TableName: table,
          Key: key
        })
      );
    }
  
    protected async query(params: QueryCommandInput) {
      const result = await ddbDocClient.send(new QueryCommand(params));
      return result.Items || [];
    }
  }