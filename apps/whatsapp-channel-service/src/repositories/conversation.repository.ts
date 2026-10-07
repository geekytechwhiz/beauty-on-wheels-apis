import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { ChannelError, CHANNEL_ERROR_CODE } from '../errors/channel-error';
import { consentPk, conversationPk, eventPk, identityPk, SK } from '../infra/keys';
import {
  BookingClaimResult,
  ChannelIdentity,
  ConversationRecord,
  MarketingConsent,
} from '../types/domain';

const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;
const CLAIM_TTL_SECONDS = 15 * 60;

export interface ConversationStore {
  get(channelUserId: string): Promise<ConversationRecord | undefined>;
  save(record: ConversationRecord, expectedVersion: number): Promise<ConversationRecord>;
  claimBooking(channelUserId: string, expectedVersion: number): Promise<BookingClaimResult>;
  attachBooking(channelUserId: string, bookingId: string, expectedVersion: number): Promise<ConversationRecord>;
  releaseBookingClaim(channelUserId: string, expectedVersion: number): Promise<void>;
  getIdentity(channelUserId: string): Promise<ChannelIdentity | undefined>;
  saveIdentity(identity: ChannelIdentity): Promise<void>;
  claimEvent(eventId: string, whatsappMessageId?: string): Promise<boolean>;
  completeEvent(eventId: string): Promise<void>;
  releaseEvent(eventId: string): Promise<void>;
  getMarketingConsent(channelUserId: string): Promise<boolean>;
  setMarketingConsent(channelUserId: string, optedIn: boolean): Promise<void>;
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException || (error instanceof Error && error.name === 'ConditionalCheckFailedException');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly identities = new Map<string, ChannelIdentity>();
  private readonly events = new Map<string, { status: 'processing' | 'processed'; lockExpiresAt: number }>();
  private readonly consent = new Map<string, boolean>();

  async get(channelUserId: string): Promise<ConversationRecord | undefined> {
    const record = this.conversations.get(channelUserId);
    return record ? clone(record) : undefined;
  }

  async save(record: ConversationRecord, expectedVersion: number): Promise<ConversationRecord> {
    const current = this.conversations.get(record.channelUserId);
    if (!current) {
      if (expectedVersion !== 0) {
        throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
      }
      const saved = { ...clone(record), version: 1 };
      this.conversations.set(record.channelUserId, saved);
      return clone(saved);
    }
    if (current.version !== expectedVersion) {
      throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
    }
    const saved = { ...clone(record), version: current.version + 1 };
    this.conversations.set(record.channelUserId, saved);
    return clone(saved);
  }

  async claimBooking(channelUserId: string, expectedVersion: number): Promise<BookingClaimResult> {
    const current = this.conversations.get(channelUserId);
    if (!current || current.version !== expectedVersion) {
      throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
    }
    const now = Math.floor(Date.now() / 1000);
    if (current.activeBookingId) return { status: 'exists', record: clone(current) };
    if (current.bookingClaim && (current.bookingClaimExpiresAt ?? 0) > now) {
      return { status: 'inProgress', record: clone(current) };
    }
    current.bookingClaim = `claim-${now}`;
    current.bookingClaimExpiresAt = now + CLAIM_TTL_SECONDS;
    current.version += 1;
    return { status: 'claimed', record: clone(current) };
  }

  async attachBooking(channelUserId: string, bookingId: string, expectedVersion: number): Promise<ConversationRecord> {
    const current = this.conversations.get(channelUserId);
    if (!current || current.version !== expectedVersion) {
      throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
    }
    current.activeBookingId = bookingId;
    current.context = { ...current.context, bookingId };
    current.bookingClaim = undefined;
    current.bookingClaimExpiresAt = undefined;
    current.version += 1;
    return clone(current);
  }

  async releaseBookingClaim(channelUserId: string, expectedVersion: number): Promise<void> {
    const current = this.conversations.get(channelUserId);
    if (!current || current.version !== expectedVersion || current.activeBookingId) return;
    current.bookingClaim = undefined;
    current.bookingClaimExpiresAt = undefined;
    current.version += 1;
  }

  async getIdentity(channelUserId: string): Promise<ChannelIdentity | undefined> {
    const identity = this.identities.get(channelUserId);
    return identity ? clone(identity) : undefined;
  }

  async saveIdentity(identity: ChannelIdentity): Promise<void> {
    this.identities.set(identity.channelUserId, clone(identity));
  }

  async claimEvent(eventId: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const current = this.events.get(eventId);
    if (!current) {
      this.events.set(eventId, { status: 'processing', lockExpiresAt: now + 120 });
      return true;
    }
    if (current.status === 'processed') return false;
    if (current.lockExpiresAt < now) {
      this.events.set(eventId, { status: 'processing', lockExpiresAt: now + 120 });
      return true;
    }
    return false;
  }

  async completeEvent(eventId: string): Promise<void> {
    const current = this.events.get(eventId);
    if (!current) return;
    current.status = 'processed';
  }

  async releaseEvent(eventId: string): Promise<void> {
    const current = this.events.get(eventId);
    if (current?.status === 'processing') this.events.delete(eventId);
  }

  async getMarketingConsent(channelUserId: string): Promise<boolean> {
    return this.consent.get(channelUserId) === true;
  }

  async setMarketingConsent(channelUserId: string, optedIn: boolean): Promise<void> {
    this.consent.set(channelUserId, optedIn);
  }
}

export class DynamoConversationStore implements ConversationStore {
  constructor(
    private readonly tableName: string,
    private readonly db: DynamoDBDocumentClient = ddbDocClient,
  ) {}

  async get(channelUserId: string): Promise<ConversationRecord | undefined> {
    const out = await this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: conversationPk(channelUserId), SK: SK.STATE },
    }));
    if (!out.Item) return undefined;
    return this.toConversation(out.Item);
  }

  async save(record: ConversationRecord, expectedVersion: number): Promise<ConversationRecord> {
    const next = { ...record, version: expectedVersion === 0 ? 1 : expectedVersion + 1, updatedAt: new Date().toISOString() };
    try {
      await this.db.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: conversationPk(record.channelUserId),
          SK: SK.STATE,
          entityType: 'Conversation',
          ...next,
        },
        ...(expectedVersion === 0
          ? { ConditionExpression: 'attribute_not_exists(PK)' }
          : { ConditionExpression: 'version = :expected', ExpressionAttributeValues: { ':expected': expectedVersion } }),
      }));
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
      }
      throw error;
    }
    return next;
  }

  async claimBooking(channelUserId: string, expectedVersion: number): Promise<BookingClaimResult> {
    const current = await this.get(channelUserId);
    if (!current || current.version !== expectedVersion) {
      throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
    }
    const now = Math.floor(Date.now() / 1000);
    if (current.activeBookingId) return { status: 'exists', record: current };
    if (current.bookingClaim && (current.bookingClaimExpiresAt ?? 0) > now) {
      return { status: 'inProgress', record: current };
    }
    const claim = `claim-${now}`;
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(channelUserId), SK: SK.STATE },
        UpdateExpression: 'SET bookingClaim = :claim, bookingClaimExpiresAt = :until, version = :next, updatedAt = :updated',
        ConditionExpression: 'version = :expected AND attribute_not_exists(activeBookingId)',
        ExpressionAttributeValues: {
          ':claim': claim,
          ':until': now + CLAIM_TTL_SECONDS,
          ':next': expectedVersion + 1,
          ':updated': new Date().toISOString(),
          ':expected': expectedVersion,
        },
      }));
    } catch (error) {
      if (isConditionalFailure(error)) {
        const latest = await this.get(channelUserId);
        if (latest?.activeBookingId) return { status: 'exists', record: latest };
        if (latest) return { status: 'inProgress', record: latest };
      }
      throw error;
    }
    return {
      status: 'claimed',
      record: { ...current, bookingClaim: claim, bookingClaimExpiresAt: now + CLAIM_TTL_SECONDS, version: expectedVersion + 1 },
    };
  }

  async attachBooking(channelUserId: string, bookingId: string, expectedVersion: number): Promise<ConversationRecord> {
    const current = await this.get(channelUserId);
    if (!current) throw new ChannelError(CHANNEL_ERROR_CODE.NOT_FOUND, 'Conversation not found');
    const next: ConversationRecord = {
      ...current,
      activeBookingId: bookingId,
      context: { ...current.context, bookingId },
      bookingClaim: undefined,
      bookingClaimExpiresAt: undefined,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(channelUserId), SK: SK.STATE },
        UpdateExpression: 'SET activeBookingId = :bookingId, context.bookingId = :bookingId, version = :next, updatedAt = :updated REMOVE bookingClaim, bookingClaimExpiresAt',
        ConditionExpression: 'version = :expected',
        ExpressionAttributeValues: {
          ':bookingId': bookingId,
          ':next': expectedVersion + 1,
          ':updated': next.updatedAt,
          ':expected': expectedVersion,
        },
      }));
    } catch (error) {
      if (isConditionalFailure(error)) {
        throw new ChannelError(CHANNEL_ERROR_CODE.CONFLICT, 'Conversation version conflict');
      }
      throw error;
    }
    return next;
  }

  async releaseBookingClaim(channelUserId: string, expectedVersion: number): Promise<void> {
    try {
      await this.db.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: conversationPk(channelUserId), SK: SK.STATE },
        UpdateExpression: 'SET version = :next, updatedAt = :updated REMOVE bookingClaim, bookingClaimExpiresAt',
        ConditionExpression: 'version = :expected AND attribute_not_exists(activeBookingId)',
        ExpressionAttributeValues: {
          ':next': expectedVersion + 1,
          ':updated': new Date().toISOString(),
          ':expected': expectedVersion,
        },
      }));
    } catch (error) {
      if (isConditionalFailure(error)) return;
      throw error;
    }
  }

  async getIdentity(channelUserId: string): Promise<ChannelIdentity | undefined> {
    const out = await this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: identityPk(channelUserId), SK: SK.IDENTITY },
    }));
    if (!out.Item) return undefined;
    const item = out.Item;
    return {
      channel: 'whatsapp',
      channelUserId: String(item.channelUserId),
      phoneNumber: String(item.phoneNumber),
      customerId: item.customerId ? String(item.customerId) : undefined,
      profileName: item.profileName ? String(item.profileName) : undefined,
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
    };
  }

  async saveIdentity(identity: ChannelIdentity): Promise<void> {
    await this.db.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: identityPk(identity.channelUserId),
        SK: SK.IDENTITY,
        entityType: 'ChannelIdentity',
        channel: identity.channel,
        channelUserId: identity.channelUserId,
        phoneNumber: identity.phoneNumber,
        customerId: identity.customerId,
        profileName: identity.profileName,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
      },
    }));
  }

  async claimEvent(eventId: string, whatsappMessageId?: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.db.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: eventPk(eventId),
          SK: SK.PROCESSED,
          entityType: 'ProcessedEvent',
          eventId,
          whatsappMessageId,
          status: 'processing',
          processedAt: new Date().toISOString(),
          lockExpiresAt: now + 120,
          expiresAt: now + EVENT_TTL_SECONDS,
        },
        ConditionExpression: 'attribute_not_exists(PK) OR (#status = :processing AND lockExpiresAt < :now)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':processing': 'processing', ':now': now },
      }));
      return true;
    } catch (error) {
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  async completeEvent(eventId: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: eventPk(eventId), SK: SK.PROCESSED },
      UpdateExpression: 'SET #status = :processed, processedAt = :at, expiresAt = :ttl REMOVE lockExpiresAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':processed': 'processed',
        ':at': new Date().toISOString(),
        ':ttl': now + EVENT_TTL_SECONDS,
      },
    }));
  }

  async releaseEvent(eventId: string): Promise<void> {
    try {
      await this.db.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: eventPk(eventId), SK: SK.PROCESSED },
        ConditionExpression: '#status = :processing',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':processing': 'processing' },
      }));
    } catch (error) {
      if (isConditionalFailure(error)) return;
      throw error;
    }
  }

  async getMarketingConsent(channelUserId: string): Promise<boolean> {
    const out = await this.db.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: consentPk(channelUserId), SK: SK.MARKETING },
    }));
    return out.Item?.optedIn === true;
  }

  async setMarketingConsent(channelUserId: string, optedIn: boolean): Promise<void> {
    const consent: MarketingConsent = {
      channel: 'whatsapp',
      channelUserId,
      optedIn,
      updatedAt: new Date().toISOString(),
    };
    await this.db.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: consentPk(channelUserId),
        SK: SK.MARKETING,
        entityType: 'MarketingConsent',
        ...consent,
      },
    }));
  }

  private toConversation(item: Record<string, unknown>): ConversationRecord {
    return {
      conversationId: String(item.conversationId),
      channel: 'whatsapp',
      channelUserId: String(item.channelUserId),
      customerId: item.customerId ? String(item.customerId) : undefined,
      state: item.state as ConversationRecord['state'],
      context: (item.context as ConversationRecord['context']) ?? {},
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
      expiresAt: Number(item.expiresAt),
      version: Number(item.version),
      activeBookingId: item.activeBookingId ? String(item.activeBookingId) : undefined,
      bookingClaim: item.bookingClaim ? String(item.bookingClaim) : undefined,
      bookingClaimExpiresAt: item.bookingClaimExpiresAt ? Number(item.bookingClaimExpiresAt) : undefined,
      lastMessageId: item.lastMessageId ? String(item.lastMessageId) : undefined,
    };
  }
}
