import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { environment } from '../../../common/config/environment.js';
import {
  DELIVERY_ENTITY_TYPE,
  DELIVERY_SK,
  DELIVERY_STATUS,
  FAILURE_CLASS,
  canApplyLifecycleStatus,
  deliveryPartitionKey,
  messageIndexKey,
  type DeliveryStatus,
  type FailureClass,
} from '../domain/delivery-status.js';
import { DeliveryStoreError } from '../domain/errors.js';
import type {
  DeliveryClaimInput,
  DeliveryClaimResult,
  DeliveryRecord,
  EmailDeliveryStore,
} from '../idempotency/email-delivery-store.js';

const TTL_SECONDS = 90 * 24 * 60 * 60;
const GSI1 = 'gsi1';

type DynamoSender = {
  send: (command: unknown) => Promise<unknown>;
};

/**
 * Conditional writes are the concurrency boundary.
 * See MemoryEmailDeliveryStore for the crash-between-SES-and-persist trade-off:
 * a stale in-progress claim without a messageId is treated as uncertain and is not resent.
 */
export class DynamoDbEmailDeliveryStore implements EmailDeliveryStore {
  private readonly docClient: DynamoSender;

  constructor(
    private readonly tableName: string,
    docClient?: DynamoSender,
    private readonly lockTimeoutMs = 150_000,
  ) {
    this.docClient =
      docClient ??
      (DynamoDBDocumentClient.from(createDynamoClient(), {
        marshallOptions: { removeUndefinedValues: true },
      }) as DynamoSender);
  }

  async claim(input: DeliveryClaimInput): Promise<DeliveryClaimResult> {
    this.assertTable();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const pk = deliveryPartitionKey(input.idempotencyKey);
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk: DELIVERY_SK,
            entityType: DELIVERY_ENTITY_TYPE,
            status: DELIVERY_STATUS.IN_PROGRESS,
            eventId: input.eventId,
            eventType: input.eventType,
            source: input.source,
            correlationId: input.correlationId,
            templateName: input.templateName,
            recipientHash: input.recipientHash,
            createdAt: nowIso,
            updatedAt: nowIso,
            ttl: Math.floor(now / 1000) + TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return { outcome: 'acquired' };
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw new DeliveryStoreError('Failed to claim email delivery', { cause: error });
      }
    }

    const existing = await this.getByPk(pk);
    if (!existing) {
      return { outcome: 'inProgress' };
    }
    if (isTerminalSuccess(existing.status) || existing.messageId) {
      return {
        outcome: 'duplicate',
        status: existing.status,
        messageId: existing.messageId,
      };
    }
    if (existing.status === DELIVERY_STATUS.FAILED && existing.failureClass === FAILURE_CLASS.PERMANENT) {
      return { outcome: 'duplicate', status: existing.status };
    }
    if (existing.status === DELIVERY_STATUS.FAILED && existing.failureClass === FAILURE_CLASS.RETRYABLE) {
      try {
        await this.docClient.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { pk, sk: DELIVERY_SK },
            UpdateExpression:
              'SET #status = :inProgress, updatedAt = :now, eventId = :eventId REMOVE failureClass, errorCode',
            ConditionExpression: '#status = :failed AND failureClass = :retryable AND attribute_not_exists(messageId)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':inProgress': DELIVERY_STATUS.IN_PROGRESS,
              ':failed': DELIVERY_STATUS.FAILED,
              ':retryable': FAILURE_CLASS.RETRYABLE,
              ':now': nowIso,
              ':eventId': input.eventId,
            },
          }),
        );
        return { outcome: 'acquired' };
      } catch (error) {
        if (!isConditionalCheckFailure(error)) {
          throw new DeliveryStoreError('Failed to reclaim email delivery', { cause: error });
        }
        const latest = await this.getByPk(pk);
        if (latest?.messageId || (latest && isTerminalSuccess(latest.status))) {
          return {
            outcome: 'duplicate',
            status: latest.status,
            messageId: latest.messageId,
          };
        }
        return { outcome: 'inProgress' };
      }
    }

    const updatedAt = Date.parse(existing.updatedAt);
    if (Number.isFinite(updatedAt) && now - updatedAt > this.lockTimeoutMs) {
      return { outcome: 'uncertain' };
    }
    return { outcome: 'inProgress' };
  }

  async markSent(idempotencyKey: string, messageId: string): Promise<void> {
    this.assertTable();
    const pk = deliveryPartitionKey(idempotencyKey);
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: DELIVERY_SK },
          UpdateExpression:
            'SET #status = :sent, messageId = :messageId, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk, updatedAt = :now',
          ConditionExpression: '#status = :inProgress AND attribute_not_exists(messageId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':sent': DELIVERY_STATUS.SENT,
            ':inProgress': DELIVERY_STATUS.IN_PROGRESS,
            ':messageId': messageId,
            ':gsi1pk': messageIndexKey(messageId),
            ':gsi1sk': DELIVERY_SK,
            ':now': new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw new DeliveryStoreError('Failed to persist SES message id', { cause: error });
      }
      const existing = await this.getByPk(pk);
      if (existing?.messageId === messageId) {
        return;
      }
      throw new DeliveryStoreError('Email delivery status changed before the message id was stored', {
        cause: error,
      });
    }
  }

  async markFailed(
    idempotencyKey: string,
    failureClass: FailureClass,
    errorCode: string,
  ): Promise<void> {
    this.assertTable();
    const pk = deliveryPartitionKey(idempotencyKey);
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: DELIVERY_SK },
          UpdateExpression:
            'SET #status = :failed, failureClass = :failureClass, errorCode = :errorCode, updatedAt = :now',
          ConditionExpression: '#status = :inProgress AND attribute_not_exists(messageId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':failed': DELIVERY_STATUS.FAILED,
            ':inProgress': DELIVERY_STATUS.IN_PROGRESS,
            ':failureClass': failureClass,
            ':errorCode': errorCode,
            ':now': new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw new DeliveryStoreError('Failed to record email delivery failure', { cause: error });
      }
    }
  }

  async recordLifecycle(
    messageId: string,
    status: DeliveryStatus,
  ): Promise<'updated' | 'ignored' | 'missing'> {
    this.assertTable();
    const result = (await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: GSI1,
        KeyConditionExpression: 'gsi1pk = :pk AND gsi1sk = :sk',
        ExpressionAttributeValues: {
          ':pk': messageIndexKey(messageId),
          ':sk': DELIVERY_SK,
        },
        Limit: 1,
      }),
    )) as { Items?: DeliveryRecord[] };
    const existing = result.Items?.[0];
    if (!existing?.pk) {
      return 'missing';
    }
    if (!canApplyLifecycleStatus(existing.status, status)) {
      return 'ignored';
    }
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: existing.pk, sk: DELIVERY_SK },
          UpdateExpression: 'SET #status = :next, updatedAt = :now',
          ConditionExpression: '#status = :current',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':next': status,
            ':current': existing.status,
            ':now': new Date().toISOString(),
          },
        }),
      );
      return 'updated';
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw new DeliveryStoreError('Failed to update email delivery status', { cause: error });
      }
      return 'ignored';
    }
  }

  private async getByPk(pk: string): Promise<DeliveryRecord | undefined> {
    try {
      const result = (await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: DELIVERY_SK },
        }),
      )) as { Item?: DeliveryRecord };
      return result.Item;
    } catch (error) {
      throw new DeliveryStoreError('Failed to read email delivery', { cause: error });
    }
  }

  private assertTable(): void {
    if (!this.tableName.trim()) {
      throw new DeliveryStoreError('EMAIL_DELIVERY_TABLE is not configured');
    }
  }
}

function createDynamoClient(): DynamoDBClient {
  if (environment.isOffline) {
    return new DynamoDBClient({
      region: environment.awsRegion,
      endpoint: environment.dynamodbEndpoint,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
  }
  return new DynamoDBClient({ region: environment.awsRegion });
}

function isConditionalCheckFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}

function isTerminalSuccess(status: DeliveryStatus): boolean {
  return (
    status === DELIVERY_STATUS.SENT ||
    status === DELIVERY_STATUS.DELIVERED ||
    status === DELIVERY_STATUS.BOUNCED ||
    status === DELIVERY_STATUS.COMPLAINED ||
    status === DELIVERY_STATUS.REJECTED
  );
}
