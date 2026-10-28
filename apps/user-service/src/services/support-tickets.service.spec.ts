import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { SupportTicketsService } from './support-tickets.service';
import { SupportTicketsRepository } from '../repositories/support-tickets.repository';
import { validateSupportTicketCreate } from '../schemas/support-tickets.schema';
import { SupportTicketRecord } from '../types/records';

function request(
  options: {
    authUserId?: string | null;
    pathUserId?: string;
    ticketId?: string;
    body?: unknown;
    key?: string | null;
  } = {},
): LambdaRequest {
  const key = options.key === undefined ? 'key-1' : options.key;
  const authUserId = options.authUserId === undefined ? 'user-1' : options.authUserId;
  return {
    pathParameters: {
      userId: options.pathUserId ?? 'user-1',
      ...(options.ticketId ? { ticketId: options.ticketId } : {}),
    },
    body: options.body ?? { category: 'BOOKING', bookingId: 'booking-1', message: 'Provider did not arrive' },
    context: authUserId ? { authContext: { userId: authUserId, roles: ['customer'] } } : {},
    event: { headers: key ? { 'Idempotency-Key': key } : {} },
  } as unknown as LambdaRequest;
}

function record(overrides: Partial<SupportTicketRecord> = {}): SupportTicketRecord {
  return {
    PK: 'USER#user-1', SK: 'SUPPORT_TICKET#t1', entityType: 'SupportTicket', ticketId: 't1', userId: 'user-1',
    status: 'OPEN', category: 'BOOKING', message: 'Provider did not arrive', bookingId: 'booking-1',
    submittedAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  } as SupportTicketRecord;
}

describe('SupportTicketsService', () => {
  let tickets: jest.Mocked<Pick<SupportTicketsRepository, 'getTicket' | 'getIdempotency' | 'listTickets' | 'createTicket'>>;
  let service: SupportTicketsService;

  beforeEach(() => {
    tickets = {
      getTicket: jest.fn().mockResolvedValue(null),
      getIdempotency: jest.fn().mockResolvedValue(null),
      listTickets: jest.fn().mockResolvedValue([]),
      createTicket: jest.fn().mockImplementation(async (ticket) => ({ PK: 'p', SK: 's', entityType: 'SupportTicket', ...ticket })),
    };
    service = new SupportTicketsService(tickets as unknown as SupportTicketsRepository);
  });

  describe('create', () => {
    it('creates an OPEN ticket for the authenticated user', async () => {
      const result = await service.create(request());

      expect(result).toMatchObject({
        userId: 'user-1', status: 'OPEN', category: 'BOOKING', bookingId: 'booking-1', message: 'Provider did not arrive',
      });
      expect(result.ticketId).toEqual(expect.any(String));
      expect(new Date(result.submittedAt).toISOString()).toBe(result.submittedAt);
      expect(tickets.createTicket).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }), 'key-1', expect.any(String));
    });

    it('omits bookingId when none was supplied', async () => {
      const result = await service.create(request({ body: { category: 'ACCOUNT', message: 'Cannot log in' } }));
      expect(result).not.toHaveProperty('bookingId');
    });

    it('rejects a path userId that differs from the authenticated user', async () => {
      await expect(service.create(request({ pathUserId: 'user-2' }))).rejects.toMatchObject({ statusCode: 403 });
      expect(tickets.createTicket).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated callers', async () => {
      await expect(service.create(request({ authUserId: null }))).rejects.toMatchObject({ statusCode: 401 });
    });

    it('requires an Idempotency-Key', async () => {
      await expect(service.create(request({ key: null }))).rejects.toMatchObject({ statusCode: 400 });
      expect(tickets.createTicket).not.toHaveBeenCalled();
    });

    it('replays the original ticket for the same key and payload without writing', async () => {
      const first = await service.create(request());
      const hash = tickets.createTicket.mock.calls[0][2];
      tickets.getIdempotency.mockResolvedValue({ ticketId: 't1', requestHash: hash } as never);
      tickets.getTicket.mockResolvedValue(record());
      tickets.createTicket.mockClear();

      const replay = await service.create(request());

      expect(replay.ticketId).toBe('t1');
      expect(first.ticketId).not.toBe('t1');
      expect(tickets.createTicket).not.toHaveBeenCalled();
    });

    it('returns 409 IDEMPOTENCY_CONFLICT when a key is reused for a different payload', async () => {
      tickets.getIdempotency.mockResolvedValue({ ticketId: 't1', requestHash: 'different' } as never);
      await expect(service.create(request())).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
      expect(tickets.createTicket).not.toHaveBeenCalled();
    });

    it('resolves a concurrent duplicate through the stored marker', async () => {
      await service.create(request());
      const hash = tickets.createTicket.mock.calls[0][2];
      tickets.createTicket.mockRejectedValue(new ConditionalWriteConflictError(new Error('conflict')));
      tickets.getIdempotency
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ticketId: 't1', requestHash: hash } as never);
      tickets.getTicket.mockResolvedValue(record());

      await expect(service.create(request())).resolves.toMatchObject({ ticketId: 't1' });
    });
  });

  describe('list and get', () => {
    it('lists only the caller tickets, newest first, without storage keys', async () => {
      tickets.listTickets.mockResolvedValue([
        record({ ticketId: 'old', submittedAt: '2026-10-27T10:00:00.000Z' }),
        record({ ticketId: 'new', submittedAt: '2026-10-28T10:00:00.000Z' }),
        record({ ticketId: 'foreign', userId: 'user-2' }),
      ]);

      const result = await service.list(request());

      expect(tickets.listTickets).toHaveBeenCalledWith('user-1');
      expect(result.items.map((item) => item.ticketId)).toEqual(['new', 'old']);
      expect(result.items[0]).not.toHaveProperty('PK');
    });

    it('refuses to list another user tickets', async () => {
      await expect(service.list(request({ pathUserId: 'user-2' }))).rejects.toMatchObject({ statusCode: 403 });
      expect(tickets.listTickets).not.toHaveBeenCalled();
    });

    it('returns a ticket to its owner and 404 otherwise', async () => {
      tickets.getTicket.mockResolvedValue(record());
      await expect(service.get(request({ ticketId: 't1' }))).resolves.toMatchObject({ ticketId: 't1', userId: 'user-1' });

      tickets.getTicket.mockResolvedValue(null);
      await expect(service.get(request({ ticketId: 'missing' }))).rejects.toMatchObject({ statusCode: 404 });
    });

    it('refuses to read another user ticket', async () => {
      await expect(service.get(request({ pathUserId: 'user-2', ticketId: 't1' }))).rejects.toMatchObject({ statusCode: 403 });
      expect(tickets.getTicket).not.toHaveBeenCalled();
    });
  });
});

describe('validateSupportTicketCreate', () => {
  const validate = (body: unknown) => validateSupportTicketCreate({ body } as unknown as LambdaRequest);

  it('trims the message and accepts the three categories', () => {
    expect(validate({ category: 'PAYMENT', message: '  refund?  ' })).toEqual({ category: 'PAYMENT', message: 'refund?' });
    expect(validate({ category: 'ACCOUNT', message: 'x' }).category).toBe('ACCOUNT');
  });

  it('enforces message length 1..4000', () => {
    expect(() => validate({ category: 'BOOKING', message: '   ' })).toThrow(EventSchemaError);
    expect(() => validate({ category: 'BOOKING', message: 'a'.repeat(4001) })).toThrow(EventSchemaError);
    expect(validate({ category: 'BOOKING', message: 'a'.repeat(4000) }).message).toHaveLength(4000);
  });

  it('rejects unknown categories, extra fields and bad booking ids', () => {
    expect(() => validate({ category: 'OTHER', message: 'x' })).toThrow(EventSchemaError);
    expect(() => validate({ category: 'BOOKING', message: 'x', userId: 'someone' })).toThrow(EventSchemaError);
    expect(() => validate({ category: 'BOOKING', message: 'x', bookingId: '../etc' })).toThrow(EventSchemaError);
    expect(() => validate(undefined)).toThrow(EventSchemaError);
  });
});
