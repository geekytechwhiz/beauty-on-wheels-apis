import { createLogger } from "@api-hub/logger";
import { TransactWriteItemsCommand, GetItemCommand, GetItemCommandOutput, UpdateItemCommand, QueryCommand, QueryCommandOutput } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { OrgOrderEntity, UserOrderEntity, OrderLogsEntity } from "../libs/dtos/orders";
import { docClient } from "../utils/db.config";

 
const log = createLogger({ service: "orders.repository" });

export class OrdersRepository {
  private doc = docClient;
  private tableName = process.env.ORDERS_TABLE || `dev_global_common_orders`;

  async transactCreate(
    orgOrder: OrgOrderEntity,
    userOrder: UserOrderEntity,
    logs: OrderLogsEntity
  ) {
    log.debug?.({ event: 'transactCreate', orderId: orgOrder.orderId, orgId: orgOrder.orgId });
    const cmd = new TransactWriteItemsCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: marshall(orgOrder, { removeUndefinedValues: true }),
            ConditionExpression:
              "attribute_not_exists(pk) AND attribute_not_exists(sk)",
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: marshall(userOrder, { removeUndefinedValues: true }),
            ConditionExpression:
              "attribute_not_exists(pk) AND attribute_not_exists(sk)",
          },
        },
        {
          Put: {
            TableName: this.tableName,
            Item: marshall(logs, { removeUndefinedValues: true }),
          },
        },
      ],
    });
    await this.doc.send(cmd);
    log.debug?.({ event: 'transactCreate_success', orderId: orgOrder.orderId });
  }

  async createOrderLogs(logs: OrderLogsEntity) {
    log.debug?.({ event: 'createOrderLogs', orderId: logs.orderId});
    await this.doc.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: marshall(logs, { removeUndefinedValues: true }),
            },
          },
        ],
      })
    );
  }

  async getByKey<T>(key: Record<string, any>): Promise<T | undefined> {
    const res = await this.doc.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall(key),
      })
    );

    return res.Item ? (unmarshall(res.Item) as T) : undefined;
  }

  async getUserOrderById(pk: string, sk: string) {
    return this.getByKey<UserOrderEntity>({ pk, sk });
  }

  async getOrderById(pk: string, sk: string) {
    log.debug?.({ event: 'getOrderById', pk, sk });
    const res = (await this.doc.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: marshall({ pk, sk }),
      })
    )) as GetItemCommandOutput;
    log.debug?.({ event: 'getOrderById_result', found: !!res.Item });
    return res.Item ? (unmarshall(res.Item) as OrgOrderEntity) : undefined;
  }

  async updateOrgOrderStatus(
    orderId: string,
    orgId: string,
    status: OrgOrderEntity["status"],
    paymentId?: string,
    entityId?: string,  
    metadata?: Record<string, any>
  ) {
      log.debug?.({ event: 'updateOrgOrderStatus', orderId, orgId, status, paymentId, entityId, hasMetadata: !!metadata });

    console.log("updateOrgOrderStatus", { paymentId, orgId });
    const pk = `ORDERS#${orgId}#ORDERS`;
    const sk = `ORDER#${orderId}`;
    // Build UpdateExpression and attributes
    let UpdateExpression = "SET #s = :s, #u = :u";
    const ExpressionAttributeNames: Record<string, string> = {
      "#s": "status",
      "#u": "updatedAt",
    };
    const eavSource: Record<string, any> = {
      s: status,
      u: new Date().toISOString(),
    };
    if (typeof paymentId !== 'undefined') {
      UpdateExpression += ", #p = :p";
      ExpressionAttributeNames["#p"] = "paymentId";
      eavSource.p = paymentId;
    }
    if (typeof entityId !== 'undefined') {
      UpdateExpression += ", #e = :e";
      ExpressionAttributeNames["#e"] = "entityId";
      eavSource.e = entityId;
    }

    console.log("eavSource--", eavSource);
    if (metadata) {
      UpdateExpression += ", #m = :m";
      ExpressionAttributeNames["#m"] = "metadata";
      eavSource.m = metadata;
    }
    const marshalled = marshall(eavSource, { removeUndefinedValues: true });
    const ExpressionAttributeValues = Object.fromEntries(
      Object.entries(marshalled).map(([k, v]) => [`:${k}` as string, v])
    );

    await this.doc.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ pk, sk }),
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      })
    );
    log.debug?.({ event: 'updateOrgOrderStatus_success', orderId });
  }

  async updateUserOrderStatus(
    orderId: string,
    userId: string,
    status: OrgOrderEntity["status"],
    metadata?: Record<string, any>
  ) {
    const pk = `USER#${userId}#ORDERS`;
    const sk = `ORDER#${orderId}`;
    const UpdateExpression = metadata
      ? "SET #s = :s, #u = :u, #m = :m"
      : "SET #s = :s, #u = :u";
    const ExpressionAttributeNames: Record<string, string> = {
      "#s": "status",
      "#u": "updatedAt",
    };
    if (metadata) {
      ExpressionAttributeNames["#m"] = "metadata";
    }
    const eavSource: Record<string, any> = {
      s: status,
      u: new Date().toISOString(),
      ...(metadata ? { m: metadata } : {}),
    };
    const marshalled = marshall(eavSource, { removeUndefinedValues: true });
    const ExpressionAttributeValues = Object.fromEntries(
      Object.entries(marshalled).map(([k, v]) => [`:${k}` as string, v])
    );
    await this.doc.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ pk, sk }),
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      })
    );
  }

  async updateOrgOrderMetadata(
    orderId: string,
    orgId: string,
    metadata: Record<string, any>
  ) {
    log.debug?.({ event: 'updateOrgOrderMetadata', orderId, orgId });
    const pk = `ORDERS#${orgId}#ORDERS`;
    const sk = `ORDER#${orderId}`;
    const marshalled = marshall({ m: metadata, u: new Date().toISOString() });
    const ExpressionAttributeValues = {
      ":m": marshalled["m"],
      ":u": marshalled["u"],
    };
    await this.doc.send(
      new UpdateItemCommand({
        TableName: this.tableName,
        Key: marshall({ pk, sk }),
        UpdateExpression: "SET #m = :m, #u = :u",
        ExpressionAttributeNames: { "#m": "metadata", "#u": "updatedAt" },
        ExpressionAttributeValues,
      })
    );
    log.debug?.({ event: 'updateOrgOrderMetadata_success', orderId });
  }

  async queryUserOrders(userId: string, limit = 20, nextToken?: string) {
    log.debug?.({ event: 'queryUserOrders', userId, limit, hasNext: !!nextToken });
    const pk = `USER#${userId}#ORDERS`;
    const params: any = {
      TableName: this.tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: marshall({
        ":pk": pk,
        ":sk": "ORDER#",
      }),
      Limit: limit,
    };
    if (nextToken) {
      params.ExclusiveStartKey = marshall(
        JSON.parse(Buffer.from(nextToken, "base64").toString("utf-8"))
      );
    }
    const res = (await this.doc.send(
      new QueryCommand(params)
    )) as QueryCommandOutput;
    const items = (res.Items || []).map((i: any) => unmarshall(i));
    const newToken = res.LastEvaluatedKey
      ? Buffer.from(
          JSON.stringify(unmarshall(res.LastEvaluatedKey as any))
        ).toString("base64")
      : undefined;
    log.debug?.({ event: 'queryUserOrders_result', count: items.length, next: !!newToken });
    return { items, nextToken: newToken };
  }

  async getOrderInvoice(orderId: string) {
    // Query for PRIMARY invoice for the order
    const pk = `ORDER#${orderId}#INVOICES`;
    const params = {
      TableName: this.tableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: marshall({ ":pk": pk }),
      ScanIndexForward: false, // latest first
    };
    const res = await this.doc.send(new QueryCommand(params));
    // Unmarshall items
    if (res.Items && res.Items.length > 0) {
      return unmarshall(res.Items[0]);
    }
    return null;
  }
}
