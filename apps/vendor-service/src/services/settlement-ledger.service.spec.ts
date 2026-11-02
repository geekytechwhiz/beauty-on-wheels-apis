import { LambdaRequest } from '@api-hub/utils';

import { SettlementStatementDdbItem } from '../domain/settlement';
import { SettlementLedgerRepository } from '../repositories/settlement-ledger.repository';
import { SettlementLedgerService } from './settlement-ledger.service';

const NOW = new Date('2026-10-31T08:00:00.000Z');

function req(input: {
  roles?: string[];
  userId?: string;
  body?: unknown;
  path?: Record<string, string>;
  key?: string | null;
}): LambdaRequest {
  return {
    body: input.body,
    pathParameters: input.path ?? {},
    params: {},
    context: {
      authContext: {
        identityId: 'identity-1',
        userId: input.userId ?? 'finance-1',
        roles: input.roles ?? ['admin'],
        permissions: [],
        claims: {},
      },
    },
    event: { headers: input.key === null ? {} : { 'Idempotency-Key': input.key ?? 'k-1' } },
  } as unknown as LambdaRequest;
}

describe('SettlementLedgerService', () => {
  let statements: Map<string, SettlementStatementDdbItem>;
  let idempotency: Map<string, { requestHash: string; statementId: string; vendorId: string }>;
  let locks: Set<string>;
  let ledger: jest.Mocked<SettlementLedgerRepository>;
  let service: SettlementLedgerService;
  const bank = {
    accountHolderName: 'Shine Wash LLP',
    accountNumber: '123456789012',
    ifscCode: 'HDFC0001234',
    bankName: 'HDFC',
  };
  let vendorBank: typeof bank | null;

  beforeEach(() => {
    statements = new Map();
    idempotency = new Map();
    locks = new Set();
    vendorBank = bank;
    ledger = {
      createStatement: jest.fn(async ({ statement, idempotency: idem }) => {
        for (const entry of statement.entries) {
          if (entry.visitId) {
            if (locks.has(entry.visitId)) {
              const { ConditionalWriteConflictError } = await import('@api-hub/utils');
              throw new ConditionalWriteConflictError(new Error('lock'), { failedTransactItemIndexes: [4] });
            }
          }
        }
        statement.entries.forEach((entry) => entry.visitId && locks.add(entry.visitId));
        statements.set(statement.statementId, statement);
        idempotency.set(idem.key, { requestHash: idem.requestHash, statementId: statement.statementId, vendorId: statement.vendorId });
      }),
      saveStatement: jest.fn(async ({ next, releaseVisitIds }) => {
        statements.set(next.statementId, next);
        (releaseVisitIds ?? []).forEach((id: string) => locks.delete(id));
      }),
      getStatement: jest.fn(async (_v: string, id: string) => statements.get(id) ?? null),
      getStatementById: jest.fn(async (id: string) => statements.get(id) ?? null),
      getIdempotency: jest.fn(async (_v: string, key: string) => idempotency.get(key) ?? null),
      listVendorStatements: jest.fn(async () => [...statements.values()]),
      listByStatus: jest.fn(async () => []),
    } as unknown as jest.Mocked<SettlementLedgerRepository>;
    service = new SettlementLedgerService(
      ledger,
      {
        getVendorById: jest.fn().mockResolvedValue({ vendorId: 'vendor-1', ownerUserId: 'owner-1' }),
        getBank: jest.fn(async () => vendorBank),
      } as never,
      () => NOW,
    );
  });

  const generateBody = {
    vendorId: 'vendor-1',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    entries: [
      { visitId: 'visit-1', amountMinor: 50000 },
      { visitId: 'visit-2', amountMinor: 70000 },
    ],
  };

  async function generated() {
    return service.generate(req({ body: generateBody }));
  }

  const path = (statementId: string) => ({ statementId });

  it('records an audited approve -> mark-paid sequence and never fabricates paid state', async () => {
    const statement = await generated();
    expect(statement.status).toBe('PENDING_REVIEW');
    expect(statement.totalMinor).toBe(120000);
    expect(statement.transferReference).toBeUndefined();
    expect(statement.paidAt).toBeUndefined();
    expect(statement.paidBy).toBeUndefined();

    // Cannot be paid straight from review.
    await expect(service.markPaid(req({
      path: path(statement.statementId),
      body: { transferReference: 'UTR-1', paidAt: '2026-10-31T07:00:00.000Z' },
    }))).rejects.toMatchObject({ statusCode: 409, code: 'STATEMENT_NOT_APPROVED' });
    expect(statements.get(statement.statementId)?.status).toBe('PENDING_REVIEW');

    await service.approve(req({ path: path(statement.statementId), body: {} }));

    // Future dates and missing references are refused.
    await expect(service.markPaid(req({
      path: path(statement.statementId),
      body: { transferReference: 'UTR-1', paidAt: '2026-11-30T00:00:00.000Z' },
    }))).rejects.toMatchObject({ code: 'PAID_AT_IN_FUTURE' });
    await expect(service.markPaid(req({
      path: path(statement.statementId),
      body: { paidAt: '2026-10-31T07:00:00.000Z' },
    }))).rejects.toBeDefined();
    expect(statements.get(statement.statementId)?.status).toBe('APPROVED');

    const paid = await service.markPaid(req({
      userId: 'finance-2',
      path: path(statement.statementId),
      body: { transferReference: 'UTR-1', paidAt: '2026-10-31T07:00:00.000Z' },
    }));
    expect(paid.status).toBe('PAID');
    expect(paid.transferReference).toBe('UTR-1');
    expect(paid.paidAt).toBe('2026-10-31T07:00:00.000Z');
    expect(paid.paidBy).toBe('finance-2');
    expect(paid.history.map((entry) => [entry.action, entry.fromStatus, entry.toStatus, entry.by])).toEqual([
      ['GENERATED', undefined, 'PENDING_REVIEW', 'finance-1'],
      ['APPROVE', 'PENDING_REVIEW', 'APPROVED', 'finance-1'],
      ['MARK_PAID', 'APPROVED', 'PAID', 'finance-2'],
    ]);
    expect(paid.history[2]).toMatchObject({ transferReference: 'UTR-1', at: NOW.toISOString() });

    // Replays are idempotent; a different reference is not accepted over a paid statement.
    const replay = await service.markPaid(req({
      path: path(statement.statementId),
      body: { transferReference: 'UTR-1', paidAt: '2026-10-31T07:00:00.000Z' },
    }));
    expect(replay.history).toHaveLength(3);
    await expect(service.markPaid(req({
      path: path(statement.statementId),
      body: { transferReference: 'UTR-OTHER', paidAt: '2026-10-31T07:00:00.000Z' },
    }))).rejects.toMatchObject({ code: 'STATEMENT_ALREADY_PAID' });
    // Paid is terminal.
    await expect(service.hold(req({ path: path(statement.statementId), body: { reason: 'too late' } })))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('masks the bank account on every statement response', async () => {
    const statement = await generated();
    expect(statement.payoutAccount).toEqual({
      accountHolderName: 'Shine Wash LLP',
      bankName: 'HDFC',
      ifscCode: 'HDFC0001234',
      accountNumberMasked: 'XXXXXXXX9012',
      accountNumberLast4: '9012',
    });
    const json = JSON.stringify(statement);
    expect(json).not.toContain('123456789012');
    const listed = await service.listForVendor(req({ userId: 'owner-1', roles: [], path: { vendorId: 'vendor-1' } }));
    expect(JSON.stringify(listed)).not.toContain('123456789012');
  });

  it('refuses approval without bank details and keeps vendor staff out', async () => {
    const statement = await generated();
    vendorBank = null;
    await expect(service.approve(req({ path: path(statement.statementId), body: {} })))
      .rejects.toMatchObject({ code: 'BANK_DETAILS_MISSING' });
    await expect(service.listForVendor(req({ userId: 'staff-9', roles: ['vendor_staff'], path: { vendorId: 'vendor-1' } })))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(service.markPaid(req({
      userId: 'owner-1',
      roles: [],
      path: path(statement.statementId),
      body: { transferReference: 'UTR-1', paidAt: '2026-10-31T07:00:00.000Z' },
    }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('holds, disputes and rejects with a reason, and rejection frees the visits', async () => {
    const statement = await generated();
    await expect(service.hold(req({ path: path(statement.statementId), body: {} }))).rejects.toBeDefined();
    const held = await service.hold(req({ path: path(statement.statementId), body: { reason: 'amount mismatch' } }));
    expect(held.status).toBe('HELD');
    const disputed = await service.dispute(req({ path: path(statement.statementId), body: { reason: 'vendor disputes' } }));
    expect(disputed.status).toBe('DISPUTED');
    expect(locks.has('visit-1')).toBe(true);
    const rejected = await service.reject(req({ path: path(statement.statementId), body: { reason: 'duplicate period' } }));
    expect(rejected.status).toBe('REJECTED');
    expect(locks.size).toBe(0);
    expect(rejected.history.map((entry) => entry.reason).filter(Boolean)).toEqual([
      'amount mismatch', 'vendor disputes', 'duplicate period',
    ]);
  });

  it('is idempotent on generate and refuses a visit that is already settled', async () => {
    const first = await generated();
    const replay = await generated();
    expect(replay.statementId).toBe(first.statementId);
    await expect(service.generate(req({ body: { ...generateBody, periodEnd: '2026-10-30' } })))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(service.generate(req({ key: 'k-2', body: generateBody })))
      .rejects.toMatchObject({ code: 'VISIT_ALREADY_SETTLED' });
    await expect(service.generate(req({ key: null, body: generateBody }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.generate(req({ roles: [], userId: 'owner-1', key: 'k-3', body: generateBody })))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
