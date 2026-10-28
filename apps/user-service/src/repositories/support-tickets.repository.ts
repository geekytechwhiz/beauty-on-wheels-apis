import { BaseRepository } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { ENTITY_TYPE } from '../domain/constants';
import {
  SupportTicketIdempotencyRecord,
  SupportTicketRecord,
} from '../types/records';
import { UserKeyBuilder, withoutUndefined } from '../utils';

export type NewSupportTicket = Omit<
  SupportTicketRecord,
  'PK' | 'SK' | 'entityType'
>;

export class SupportTicketsRepository extends BaseRepository {
  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async getTicket(
    userId: string,
    ticketId: string,
  ): Promise<SupportTicketRecord | null> {
    return this.get<SupportTicketRecord>(this.getTableName(), {
      PK: UserKeyBuilder.userPk(userId),
      SK: UserKeyBuilder.supportTicketSk(ticketId),
    });
  }

  async getIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<SupportTicketIdempotencyRecord | null> {
    return this.get<SupportTicketIdempotencyRecord>(this.getTableName(), {
      PK: UserKeyBuilder.userPk(userId),
      SK: UserKeyBuilder.supportTicketIdempotencySk(idempotencyKey),
    });
  }

  /** Access pattern: a user's tickets share the USER# partition under SUPPORT_TICKET#. */
  async listTickets(userId: string): Promise<SupportTicketRecord[]> {
    return this.queryAll<SupportTicketRecord>({
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': UserKeyBuilder.userPk(userId),
        ':prefix': UserKeyBuilder.supportTicketSkPrefix(),
      },
    });
  }

  /** Atomically stores the ticket and its idempotency marker; throws ConditionalWriteConflictError on a race. */
  async createTicket(
    ticket: NewSupportTicket,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<SupportTicketRecord> {
    const pk = UserKeyBuilder.userPk(ticket.userId);
    const record: SupportTicketRecord = withoutUndefined({
      PK: pk,
      SK: UserKeyBuilder.supportTicketSk(ticket.ticketId),
      entityType: ENTITY_TYPE.SUPPORT_TICKET,
      ...ticket,
    });
    const marker: SupportTicketIdempotencyRecord = {
      PK: pk,
      SK: UserKeyBuilder.supportTicketIdempotencySk(idempotencyKey),
      entityType: ENTITY_TYPE.SUPPORT_TICKET_IDEMPOTENCY,
      ticketId: ticket.ticketId,
      userId: ticket.userId,
      requestHash,
      createdAt: ticket.submittedAt,
    };

    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: record,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: marker,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    });

    return record;
  }
}

let repository: SupportTicketsRepository;

export function getSupportTicketsRepository(): SupportTicketsRepository {
  if (!repository) {
    repository = new SupportTicketsRepository();
  }
  return repository;
}
