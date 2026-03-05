import { QueryCommandInput } from "@aws-sdk/lib-dynamodb";

export const buildPkQuery = (
  table: string,
  pk: string
): QueryCommandInput => ({
  TableName: table,
  KeyConditionExpression: "pk = :pk",
  ExpressionAttributeValues: {
    ":pk": pk
  }
});

export const buildPrefixQuery = (
  table: string,
  pk: string,
  skPrefix: string
): QueryCommandInput => ({
  TableName: table,
  KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
  ExpressionAttributeValues: {
    ":pk": pk,
    ":sk": skPrefix
  }
});