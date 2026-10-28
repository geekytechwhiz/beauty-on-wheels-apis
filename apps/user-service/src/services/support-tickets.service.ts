import { createHash, randomUUID } from 'crypto';

import { createChildLogger, createLogger } from '@api-hub/observability';
import {
  BaseError,
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';

import {
  getSupportTicketsRepository,
  SupportTicketsRepository,
} from '../repositories/support-tickets.repository';
import { SupportTicket, SupportTicketCreate } from '../types/api-types';
import { SupportTicketRecord } from '../types/records';
import { getAuthenticatedUserId, getPathParam, getUserId } from '../utils';

const baseLogger = createLogger({
  service: 'support-tickets-service',
  redactPII: true,
});

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export function toSupportTicket(record: SupportTicketRecord): SupportTicket {
  return {
    ticketId: record.ticketId,
    userId: record.userId,
    status: record.status,
    category: record.category,
    message: record.message,
    ...(record.bookingId ? { bookingId: record.bookingId } : {}),
    submittedAt: record.submittedAt,
  };
}

function headerValue(request: LambdaRequest, name: string): string | undefined {
  const headers = request.event?.headers ?? {};
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function fingerprint(command: SupportTicketCreate): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        category: command.category,
        bookingId: command.bookingId ?? null,
        message: command.message,
      }),
    )
    .digest('hex');
}

export class SupportTicketsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'SupportTicketsService',
  });

  constructor(
    private readonly tickets: SupportTicketsRepository = getSupportTicketsRepository(),
  ) {}

  /**
   * Support tickets are private to the customer: the path userId must equal the
   * authenticated user. Admin/service access is intentionally not granted here.
   */
  private assertOwner(request: LambdaRequest): string {
    const authenticated = getAuthenticatedUserId(request);
    const pathUserId = getUserId(request);
    if (authenticated !== pathUserId) {
      throw new ForbiddenError('Not authorized to access support tickets for this user');
    }
    return authenticated;
  }

  async create(request: LambdaRequest): Promise<SupportTicket> {
    const userId = this.assertOwner(request);
    const idempotencyKey = headerValue(request, 'Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new ValidationError('Idempotency-Key header is required');
    }

    const command = request.body as SupportTicketCreate;
    const requestHash = fingerprint(command);

    const existing = await this.tickets.getIdempotency(userId, idempotencyKey);
    if (existing) {
      return this.replay(userId, existing.ticketId, existing.requestHash, requestHash);
    }

    const submittedAt = new Date().toISOString();
    try {
      const record = await this.tickets.createTicket(
        {
          ticketId: randomUUID(),
          userId,
          status: 'OPEN',
          category: command.category,
          message: command.message,
          bookingId: command.bookingId,
          submittedAt,
          updatedAt: submittedAt,
        },
        idempotencyKey,
        requestHash,
      );
      this.logger.info({
        event: 'support_ticket_created',
        userId,
        ticketId: record.ticketId,
        category: record.category,
      });
      return toSupportTicket(record);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.tickets.getIdempotency(userId, idempotencyKey);
        if (raced) {
          return this.replay(userId, raced.ticketId, raced.requestHash, requestHash);
        }
        throw new ConflictError('The ticket request was processed concurrently; retry with the same Idempotency-Key');
      }
      throw error;
    }
  }

  async list(request: LambdaRequest): Promise<{ items: SupportTicket[] }> {
    const userId = this.assertOwner(request);
    const records = await this.tickets.listTickets(userId);
    const items = records
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map(toSupportTicket);
    return { items };
  }

  async get(request: LambdaRequest): Promise<SupportTicket> {
    const userId = this.assertOwner(request);
    const ticketId = getPathParam(request, 'ticketId');
    const record = await this.tickets.getTicket(userId, ticketId);
    if (!record || record.userId !== userId) {
      throw new NotFoundError('Support ticket not found');
    }
    return toSupportTicket(record);
  }

  private async replay(
    userId: string,
    ticketId: string,
    storedHash: string,
    requestHash: string,
  ): Promise<SupportTicket> {
    if (storedHash !== requestHash) {
      throw new BaseError(
        'Idempotency-Key was already used for a different support ticket request',
        409,
        'IDEMPOTENCY_CONFLICT',
        [{ field: 'Idempotency-Key', message: 'Key reused with a different payload' }],
      );
    }
    const record = await this.tickets.getTicket(userId, ticketId);
    if (!record) {
      throw new NotFoundError('Support ticket not found');
    }
    return toSupportTicket(record);
  }
}

let service: SupportTicketsService;

export function getSupportTicketsService(): SupportTicketsService {
  if (!service) {
    service = new SupportTicketsService();
  }
  return service;
}
