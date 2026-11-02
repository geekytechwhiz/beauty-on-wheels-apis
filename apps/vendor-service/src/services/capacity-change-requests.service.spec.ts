import { ConditionalWriteConflictError, LambdaRequest } from '@api-hub/utils';

import { CapacityChangeRequestDdbItem, evaluateApproval } from '../domain/capacity-change';
import { CapacityChangeRequestsRepository } from '../repositories/capacity-change-requests.repository';
import { CapacityChangeRequestsService } from './capacity-change-requests.service';

const NOW = new Date('2026-10-31T08:00:00.000Z');

function req(input: { roles?: string[]; userId?: string; body?: unknown; path?: Record<string, string>; key?: string }): LambdaRequest {
  return {
    body: input.body,
    pathParameters: input.path ?? {},
    params: {},
    context: {
      authContext: {
        identityId: 'identity-1',
        userId: input.userId ?? 'owner-1',
        roles: input.roles ?? [],
        permissions: [],
        claims: {},
      },
    },
    event: { headers: { 'Idempotency-Key': input.key ?? 'k-1' } },
  } as unknown as LambdaRequest;
}

describe('evaluateApproval', () => {
  const base = { currentQuantity: 10, requestedQuantity: 4, reservedSoldQuantity: 6 };

  it('never reduces below sold without an explicit coverage decision', () => {
    expect(() => evaluateApproval(base)).toThrow(expect.objectContaining({ code: 'REPLACEMENT_COVERAGE_REQUIRED' }));
    expect(() => evaluateApproval({ ...base, decision: { decision: 'REJECT' } }))
      .toThrow(expect.objectContaining({ code: 'REPLACEMENT_COVERAGE_REJECTED' }));
    expect(evaluateApproval({ ...base, decision: { decision: 'COVERED_ELSEWHERE' } }))
      .toMatchObject({ newQuantity: 4, newStatus: 'REDUCED', salesBlocked: false });
    expect(evaluateApproval({ ...base, decision: { decision: 'BLOCK_SALES' } }).salesBlocked).toBe(true);
  });

  it('allows a reduction at or above sold and an increase without a decision', () => {
    expect(evaluateApproval({ ...base, requestedQuantity: 6 })).toMatchObject({ newQuantity: 6, newStatus: 'REDUCED' });
    expect(evaluateApproval({ ...base, requestedQuantity: 12 })).toMatchObject({ newQuantity: 12, newStatus: 'ACTIVE' });
  });
});

describe('CapacityChangeRequestsService', () => {
  let requests: Map<string, CapacityChangeRequestDdbItem>;
  let commitment: Record<string, unknown>;
  let repo: jest.Mocked<CapacityChangeRequestsRepository>;
  let service: CapacityChangeRequestsService;

  beforeEach(() => {
    requests = new Map();
    commitment = {
      commitmentId: 'cmt-1',
      vendorId: 'vendor-1',
      quantity: 10,
      reservedSoldQuantity: 6,
      status: 'ACTIVE',
      window: {
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        dailyWindow: { startTime: '08:00', endTime: '12:00' },
      },
    };
    repo = {
      getIdempotency: jest.fn().mockResolvedValue(null),
      createRequest: jest.fn(async ({ item }) => {
        requests.set(item.requestId, item);
        commitment = { ...commitment, status: 'CHANGE_PENDING', pendingChangeRequestId: item.requestId };
      }),
      getRequest: jest.fn(async (_v: string, id: string) => requests.get(id) ?? null),
      getRequestById: jest.fn(async (id: string) => requests.get(id) ?? null),
      listVendorRequests: jest.fn(async () => [...requests.values()]),
      approve: jest.fn(async (input) => {
        requests.set(input.item.requestId, input.item);
        commitment = { ...commitment, quantity: input.newQuantity, status: input.newStatus };
        delete commitment.pendingChangeRequestId;
      }),
      reject: jest.fn(async ({ item }) => {
        requests.set(item.requestId, item);
        commitment = { ...commitment, status: item.commitmentStatusBefore };
        delete commitment.pendingChangeRequestId;
      }),
    } as unknown as jest.Mocked<CapacityChangeRequestsRepository>;
    service = new CapacityChangeRequestsService(
      repo,
      {
        getCommitment: jest.fn(async () => commitment),
        getLedger: jest.fn().mockResolvedValue({ version: 3 }),
        listCommitments: jest.fn(async () => [commitment]),
      } as never,
      { getVendorById: jest.fn().mockResolvedValue({ vendorId: 'vendor-1', ownerUserId: 'owner-1' }) } as never,
      { listAllCrews: jest.fn().mockResolvedValue([{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'INACTIVE' }]) } as never,
      () => NOW,
    );
  });

  const create = (quantity: number) => service.create(req({
    path: { vendorId: 'vendor-1' },
    body: { commitmentId: 'cmt-1', requestedQuantity: quantity, reason: 'Lost a crew member' },
  }));
  const admin = (body: unknown, requestId: string) => req({ userId: 'admin-1', roles: ['admin'], body, path: { requestId } });

  it('keeps the quantity unchanged while PENDING and flips the commitment to CHANGE_PENDING', async () => {
    const created = await create(4);
    expect(created.status).toBe('PENDING');
    expect(created.currentQuantity).toBe(10);
    expect(commitment).toMatchObject({ status: 'CHANGE_PENDING', quantity: 10 });
    expect(repo.createRequest).toHaveBeenCalledWith(expect.objectContaining({ expectedCommitmentQuantity: 10 }));
    // A second request while pending is refused.
    await expect(create(5)).rejects.toMatchObject({ statusCode: 409, code: 'CHANGE_ALREADY_PENDING' });
  });

  it('refuses to approve a reduction below sold without coverage, then approves with it', async () => {
    const created = await create(4);
    await expect(service.approve(admin({}, created.requestId)))
      .rejects.toMatchObject({ statusCode: 409, code: 'REPLACEMENT_COVERAGE_REQUIRED' });
    await expect(service.approve(admin({ replacementCoverageDecision: { decision: 'REJECT' } }, created.requestId)))
      .rejects.toMatchObject({ code: 'REPLACEMENT_COVERAGE_REJECTED' });
    expect(repo.approve).not.toHaveBeenCalled();
    expect(commitment).toMatchObject({ quantity: 10, status: 'CHANGE_PENDING' });

    const approved = await service.approve(admin(
      { replacementCoverageDecision: { decision: 'COVERED_ELSEWHERE', note: 'moved to vendor-2' } },
      created.requestId,
    ));
    expect(approved.status).toBe('APPROVED');
    expect(approved.replacementCoverageDecision?.decision).toBe('COVERED_ELSEWHERE');
    expect(approved.soldQuantityAtDecision).toBe(6);
    expect(repo.approve).toHaveBeenCalledWith(expect.objectContaining({
      expectedQuantity: 10,
      expectedSoldQuantity: 6,
      newQuantity: 4,
      newStatus: 'REDUCED',
      expectedLedgerVersion: 3,
    }));
    expect(commitment).toMatchObject({ quantity: 4, status: 'REDUCED' });
  });

  it('turns a sold-quantity race into a 409 instead of reducing silently', async () => {
    const created = await create(4);
    repo.approve.mockRejectedValueOnce(new ConditionalWriteConflictError(new Error('race')));
    await expect(service.approve(admin({ replacementCoverageDecision: { decision: 'BLOCK_SALES' } }, created.requestId)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(commitment).toMatchObject({ quantity: 10, status: 'CHANGE_PENDING' });
  });

  it('rejects, restoring the commitment, and only admins decide', async () => {
    const created = await create(8);
    await expect(service.reject(req({ path: { requestId: created.requestId }, body: { reason: 'not now' } })))
      .rejects.toMatchObject({ statusCode: 403 });
    const rejected = await service.reject(admin({ reason: 'Demand is high' }, created.requestId));
    expect(rejected.status).toBe('REJECTED');
    expect(commitment).toMatchObject({ quantity: 10, status: 'ACTIVE' });
    await expect(service.approve(admin({}, created.requestId))).rejects.toMatchObject({ code: 'CHANGE_ALREADY_DECIDED' });
  });

  it('checks crew capacity before growing a commitment', async () => {
    const created = await create(20);
    await expect(service.approve(admin({}, created.requestId))).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.approve).not.toHaveBeenCalled();
  });
});
