import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';

import {
  CapacityCommitmentDdbItem,
  ServiceWindow,
} from '../domain/capacity-commitment';
import { CapacityProposalDdbItem, hashRequest } from '../domain/capacity-proposal';
import {
  ACCEPT_TX,
  CapacityProposalsRepository,
} from '../repositories/capacity-proposals.repository';
import { CommunitiesRepository } from '../repositories/communities.repository';
import { CrewRepository } from '../repositories/crew.repository';
import { StaffRepository } from '../repositories/staff.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { CrewDdbItem, VendorDdbItem } from '../types/repository.types';
import { CapacityProposalsService } from './capacity-proposals.service';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const WINDOW: ServiceWindow = {
  startDate: '2026-11-02',
  endDate: '2026-11-08',
  dailyWindow: { startTime: '09:00', endTime: '13:00' },
};

function request(input: {
  user?: 'owner' | 'admin' | 'stranger' | 'manager';
  vendorId?: string;
  proposalId?: string;
  body?: unknown;
  key?: string | null;
  params?: Record<string, unknown>;
} = {}): LambdaRequest {
  const user = input.user ?? 'owner';
  const userId = { owner: 'owner-1', admin: 'admin-1', stranger: 'user-9', manager: 'mgr-1' }[user];
  const roles = user === 'admin' ? ['admin'] : [];
  const permissions = user === 'manager' ? ['communities:manage'] : [];
  const pathParameters: Record<string, string> = {};
  if (input.vendorId) pathParameters.vendorId = input.vendorId;
  if (input.proposalId) pathParameters.proposalId = input.proposalId;
  return {
    event: {
      headers: input.key === null ? {} : { 'idempotency-key': input.key ?? 'key-1' },
    },
    pathParameters,
    params: { ...pathParameters, ...(input.params ?? {}) },
    body: input.body,
    context: {
      userContext: { userId, roles, permissions },
      authContext: { userId, roles, permissions, claims: {} },
    },
  } as unknown as LambdaRequest;
}

function vendor(): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'owner-1',
    status: 'ACTIVE',
    operationalStatus: 'ONLINE',
  } as unknown as VendorDdbItem;
}

function crew(id: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): CrewDdbItem {
  return { crewId: id, vendorId: 'vendor-1', status } as unknown as CrewDdbItem;
}

function proposal(overrides: Partial<CapacityProposalDdbItem> = {}): CapacityProposalDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'CAPACITY_PROPOSAL#cpr_1',
    GSI1PK: 'CAPACITY_PROPOSAL',
    GSI1SK: 'STATUS#SENT#2026-10-30T00:00:00.000Z#cpr_1',
    GSI3PK: 'CAPACITY_COMMUNITY#com-1',
    GSI3SK: 'PROPOSAL#2026-10-30T00:00:00.000Z#cpr_1',
    proposalId: 'cpr_1',
    vendorId: 'vendor-1',
    communityId: 'com-1',
    packageScope: { serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' },
    serviceWindow: WINDOW,
    quantity: 6,
    responseDeadline: '2026-11-05T00:00:00.000Z',
    proposedPayoutRate: { amountMinor: 25000, currency: 'INR' },
    status: 'SENT',
    history: [],
    createdBy: 'admin-1',
    idempotencyKey: 'create-key',
    version: 1,
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    entityType: 'CapacityProposal',
    ...overrides,
  };
}

function commitment(
  quantity: number,
  window: ServiceWindow = WINDOW,
  status: CapacityCommitmentDdbItem['status'] = 'ACTIVE',
): CapacityCommitmentDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: `CAPACITY_COMMITMENT#cmt_${quantity}`,
    commitmentId: `cmt_${quantity}`,
    proposalId: `other_${quantity}`,
    vendorId: 'vendor-1',
    communityId: 'com-other',
    scope: { serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' },
    window,
    quantity,
    rate: { amountMinor: 25000, currency: 'INR' },
    status,
    reservedSoldQuantity: 0,
    createdBy: 'admin-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    entityType: 'CapacityCommitment',
  };
}

describe('CapacityProposalsService', () => {
  let repository: jest.Mocked<CapacityProposalsRepository>;
  let communities: jest.Mocked<CommunitiesRepository>;
  let vendors: jest.Mocked<VendorsRepository>;
  let crews: jest.Mocked<CrewRepository>;
  let staff: jest.Mocked<StaffRepository>;
  let service: CapacityProposalsService;

  beforeEach(() => {
    repository = {
      getIdempotency: jest.fn().mockResolvedValue(null),
      getProposal: jest.fn().mockResolvedValue(proposal()),
      getProposalById: jest.fn().mockResolvedValue(proposal()),
      getLedger: jest.fn().mockResolvedValue(null),
      listCommitments: jest.fn().mockResolvedValue([]),
      getCommitment: jest.fn().mockResolvedValue(null),
      listProposals: jest.fn().mockResolvedValue({ items: [] }),
      createProposal: jest.fn().mockResolvedValue(undefined),
      transitionProposal: jest.fn().mockResolvedValue(undefined),
      acceptProposal: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CapacityProposalsRepository>;
    communities = {
      assertApprovedCoverage: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<CommunitiesRepository>;
    vendors = {
      getVendorById: jest.fn().mockResolvedValue(vendor()),
    } as unknown as jest.Mocked<VendorsRepository>;
    // Three active crews x 4 visits = 12 slots per day. The inactive crew does not count.
    crews = {
      listAllCrews: jest.fn().mockResolvedValue([crew('a'), crew('b'), crew('c'), crew('d', 'INACTIVE')]),
    } as unknown as jest.Mocked<CrewRepository>;
    staff = {
      listMembershipsByUserId: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<StaffRepository>;
    service = new CapacityProposalsService(repository, communities, vendors, crews, staff, {
      now: () => NOW,
    });
  });

  describe('vendor accept: capacity overlap', () => {
    const accept = () =>
      service.acceptvendorcapacityproposal(
        request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: {} }),
      );

    it('creates the commitment with the ACCEPTED proposal in one transaction', async () => {
      const result = await accept();

      expect(repository.acceptProposal).toHaveBeenCalledTimes(1);
      const call = repository.acceptProposal.mock.calls[0][0];
      expect(call.item.status).toBe('ACCEPTED');
      expect(call.expectedVersion).toBe(1);
      expect(call.expectedLedgerVersion).toBe(0);
      expect(call.commitment).toMatchObject({
        proposalId: 'cpr_1',
        vendorId: 'vendor-1',
        communityId: 'com-1',
        quantity: 6,
        status: 'ACTIVE',
        reservedSoldQuantity: 0,
      });
      expect(call.item.commitmentId).toBe(call.commitment.commitmentId);
      expect(call.item.history.at(-1)).toMatchObject({
        actorId: 'owner-1',
        actorRole: 'VENDOR',
        action: 'ACCEPT',
        fromStatus: 'SENT',
        toStatus: 'ACCEPTED',
      });
      expect(result.data.status).toBe('ACCEPTED');
      expect(result.data.commitment?.commitmentId).toBe(call.commitment.commitmentId);
      expect(result.data).not.toHaveProperty('idempotencyKey');
    });

    it('accepts when overlapping active commitments still leave room', async () => {
      repository.listCommitments.mockResolvedValue([commitment(6)]);
      await expect(accept()).resolves.toBeDefined();
    });

    it('409s when overlapping active commitments (any community) would exceed crew capacity', async () => {
      repository.listCommitments.mockResolvedValue([commitment(7)]);
      await expect(accept()).rejects.toThrow(ConflictError);
      await expect(accept()).rejects.toThrow(/exceed the vendor crew capacity/);
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('does not count cancelled or non-overlapping commitments', async () => {
      repository.listCommitments.mockResolvedValue([
        commitment(12, WINDOW, 'CANCELLED'),
        commitment(11, { ...WINDOW, startDate: '2026-12-01', endDate: '2026-12-07' }),
        commitment(10, { ...WINDOW, dailyWindow: { startTime: '15:00', endTime: '18:00' } }),
      ]);
      await expect(accept()).resolves.toBeDefined();
    });

    it('409s when the vendor has no active crew', async () => {
      crews.listAllCrews.mockResolvedValue([crew('a', 'INACTIVE')]);
      await expect(accept()).rejects.toThrow(ConflictError);
    });

    it('409s instead of overselling when a concurrent accept bumped the ledger', async () => {
      repository.getLedger.mockResolvedValue({ version: 3 } as never);
      repository.acceptProposal.mockRejectedValue(
        new ConditionalWriteConflictError(new Error('cancelled'), {
          failedTransactItemIndexes: [ACCEPT_TX.LEDGER],
        }),
      );

      await expect(accept()).rejects.toThrow(/capacity changed/i);
      expect(repository.acceptProposal.mock.calls[0][0].expectedLedgerVersion).toBe(3);
    });

    it('409s when the proposal changed underneath the accept', async () => {
      repository.acceptProposal.mockRejectedValue(
        new ConditionalWriteConflictError(new Error('cancelled'), {
          failedTransactItemIndexes: [ACCEPT_TX.PROPOSAL],
        }),
      );
      await expect(accept()).rejects.toThrow(ConflictError);
    });

    it('rejects an accept of a proposal that is not SENT', async () => {
      repository.getProposal.mockResolvedValue(proposal({ status: 'COUNTERED' }));
      await expect(accept()).rejects.toThrow(ConflictError);
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('expires an unanswered proposal past its deadline instead of committing', async () => {
      repository.getProposal.mockResolvedValue(
        proposal({ responseDeadline: '2026-10-31T00:00:00.000Z' }),
      );
      await expect(accept()).rejects.toThrow(/deadline/);
      expect(repository.acceptProposal).not.toHaveBeenCalled();
      const expired = repository.transitionProposal.mock.calls[0][0];
      expect(expired.item.status).toBe('EXPIRED');
      expect(expired.item.history.at(-1)).toMatchObject({ actorRole: 'SYSTEM', action: 'EXPIRE' });
    });
  });

  describe('approved coverage requirement', () => {
    it('blocks accept when coverage is not approved, before any capacity or write', async () => {
      communities.assertApprovedCoverage.mockRejectedValue(
        new ConflictError('Community coverage must be approved'),
      );
      await expect(
        service.acceptvendorcapacityproposal(
          request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: {} }),
        ),
      ).rejects.toThrow(/coverage must be approved/);
      expect(communities.assertApprovedCoverage).toHaveBeenCalledWith('vendor-1', 'com-1');
      expect(repository.listCommitments).not.toHaveBeenCalled();
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('blocks proposal creation when coverage is not approved', async () => {
      communities.assertApprovedCoverage.mockRejectedValue(
        new ConflictError('Community coverage must be approved'),
      );
      await expect(service.createcapacityproposal(request({ user: 'admin', body: createBody() })))
        .rejects.toThrow(ConflictError);
      expect(repository.createProposal).not.toHaveBeenCalled();
    });

    it('409s when coverage is suspended between the read and the write', async () => {
      repository.acceptProposal.mockRejectedValue(
        new ConditionalWriteConflictError(new Error('cancelled'), {
          failedTransactItemIndexes: [ACCEPT_TX.COVERAGE],
        }),
      );
      await expect(
        service.acceptvendorcapacityproposal(
          request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: {} }),
        ),
      ).rejects.toThrow(/coverage must be approved/);
    });
  });

  describe('counter, decline, and no phantom commitments', () => {
    it('counters with the vendor quantity and rate and never writes a commitment', async () => {
      const result = await service.countervendorcapacityproposal(
        request({
          vendorId: 'vendor-1',
          proposalId: 'cpr_1',
          body: { quantity: 4, payoutRate: { amountMinor: 30000, currency: 'INR' }, note: 'Two crews only' },
        }),
      );

      expect(repository.acceptProposal).not.toHaveBeenCalled();
      const written = repository.transitionProposal.mock.calls[0][0];
      expect(written.item).toMatchObject({
        status: 'COUNTERED',
        quantity: 4,
        proposedPayoutRate: { amountMinor: 30000, currency: 'INR' },
        version: 2,
      });
      expect(written.item.GSI1SK).toContain('STATUS#COUNTERED#');
      expect(written.item.counter).toMatchObject({ previousQuantity: 6, quantity: 4 });
      expect(written.item).not.toHaveProperty('commitmentId');
      expect(result.data.status).toBe('COUNTERED');
      expect(result.data.commitment).toBeUndefined();
    });

    it('lets ops accept the counter, which is the only point a commitment appears', async () => {
      repository.getProposalById.mockResolvedValue(
        proposal({ status: 'COUNTERED', quantity: 4 }),
      );
      const result = await service.acceptcapacitycounter(
        request({ user: 'admin', proposalId: 'cpr_1', body: {} }),
      );
      const call = repository.acceptProposal.mock.calls[0][0];
      expect(call.commitment.quantity).toBe(4);
      expect(call.item.history.at(-1)).toMatchObject({ actorRole: 'ADMIN', action: 'ACCEPT_COUNTER' });
      expect(result.data.idempotencyKey).toBe('create-key');
    });

    it('applies the capacity rule to a countered quantity too', async () => {
      repository.getProposalById.mockResolvedValue(proposal({ status: 'COUNTERED', quantity: 8 }));
      repository.listCommitments.mockResolvedValue([commitment(6)]);
      await expect(
        service.acceptcapacitycounter(request({ user: 'admin', proposalId: 'cpr_1', body: {} })),
      ).rejects.toThrow(ConflictError);
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('vendor decline and ops decline write no commitment', async () => {
      await service.declinevendorcapacityproposal(
        request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: { reason: 'Busy' } }),
      );
      expect(repository.transitionProposal.mock.calls[0][0].item.status).toBe('DECLINED');

      repository.getProposalById.mockResolvedValue(proposal({ status: 'DRAFT' }));
      await service.declinecapacityproposal(
        request({ user: 'admin', proposalId: 'cpr_1', body: {}, key: 'key-2' }),
      );
      expect(repository.transitionProposal.mock.calls[1][0].item.status).toBe('CANCELLED');
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('ops revise sends the proposal again with the new terms and a fresh deadline', async () => {
      repository.getProposalById.mockResolvedValue(proposal({ status: 'COUNTERED', quantity: 4 }));
      await service.revisecapacityproposal(
        request({
          user: 'admin',
          proposalId: 'cpr_1',
          body: { quantity: 5, responseDeadline: '2026-11-10T00:00:00.000Z' },
        }),
      );
      const written = repository.transitionProposal.mock.calls[0][0];
      expect(written.item).toMatchObject({ status: 'SENT', quantity: 5 });
      expect(written.item).not.toHaveProperty('counter');
      expect(written.requireApprovedCoverage).toBe(true);
      expect(communities.assertApprovedCoverage).toHaveBeenCalledWith('vendor-1', 'com-1');
    });

    it('rejects a counter on a proposal the vendor can no longer answer', async () => {
      repository.getProposal.mockResolvedValue(proposal({ status: 'ACCEPTED' }));
      await expect(
        service.countervendorcapacityproposal(
          request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: { quantity: 2 } }),
        ),
      ).rejects.toThrow(ConflictError);
      expect(repository.transitionProposal).not.toHaveBeenCalled();
    });
  });

  describe('creation and idempotency', () => {
    it('creates a SENT proposal with history, version, and the idempotency key', async () => {
      const result = await service.createcapacityproposal(
        request({ user: 'admin', body: createBody(), key: 'create-1' }),
      );
      const call = repository.createProposal.mock.calls[0][0];
      expect(call.item).toMatchObject({
        vendorId: 'vendor-1',
        communityId: 'com-1',
        status: 'SENT',
        version: 1,
        createdBy: 'admin-1',
        idempotencyKey: 'create-1',
      });
      expect(call.item.history.map((entry) => entry.action)).toEqual(['CREATE', 'SEND']);
      expect(call.idempotency.requestHash).toHaveLength(64);
      expect(result.data.idempotencyKey).toBe('create-1');
    });

    it('creates a DRAFT when sendImmediately is false', async () => {
      await service.createcapacityproposal(
        request({ user: 'admin', body: { ...createBody(), sendImmediately: false } }),
      );
      expect(repository.createProposal.mock.calls[0][0].item.status).toBe('DRAFT');
    });

    it('requires an Idempotency-Key on mutations', async () => {
      await expect(
        service.createcapacityproposal(request({ user: 'admin', body: createBody(), key: null })),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.acceptvendorcapacityproposal(
          request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: {}, key: null }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('replays the stored outcome for the same key and body without writing again', async () => {
      const body = {};
      repository.getIdempotency.mockResolvedValue({
        requestHash: hashRequest(body),
        vendorId: 'vendor-1',
        proposalId: 'cpr_1',
        commitmentId: 'cmt_x',
      } as never);
      repository.getProposal.mockResolvedValue(proposal({ status: 'ACCEPTED', commitmentId: 'cmt_x' }));
      repository.getCommitment.mockResolvedValue(commitment(6));

      const result = await service.acceptvendorcapacityproposal(
        request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body }),
      );

      expect(result.data.status).toBe('ACCEPTED');
      expect(result.data.commitment).toBeDefined();
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('409s when a key is reused with a different body', async () => {
      repository.getIdempotency.mockResolvedValue({ requestHash: 'different', proposalId: 'cpr_1' } as never);
      await expect(
        service.countervendorcapacityproposal(
          request({ vendorId: 'vendor-1', proposalId: 'cpr_1', body: { quantity: 2 } }),
        ),
      ).rejects.toThrow(/different request/);
    });
  });

  describe('authorization', () => {
    it('requires an admin for ops routes', async () => {
      await expect(service.createcapacityproposal(request({ body: createBody() }))).rejects.toThrow(ForbiddenError);
      await expect(service.listcapacityproposals(request())).rejects.toThrow(ForbiddenError);
      await expect(
        service.acceptcapacitycounter(request({ proposalId: 'cpr_1', body: {} })),
      ).rejects.toThrow(ForbiddenError);
    });

    it('never lets a non-member answer for the path vendor', async () => {
      await expect(
        service.acceptvendorcapacityproposal(
          request({ user: 'stranger', vendorId: 'vendor-1', proposalId: 'cpr_1', body: {} }),
        ),
      ).rejects.toThrow(ForbiddenError);
      expect(repository.acceptProposal).not.toHaveBeenCalled();
    });

    it('does not let an admin answer as the vendor', async () => {
      await expect(
        service.acceptvendorcapacityproposal(
          request({ user: 'admin', vendorId: 'vendor-1', proposalId: 'cpr_1', body: {} }),
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows an active staff manager that carries communities:manage', async () => {
      staff.listMembershipsByUserId.mockResolvedValue([
        { vendorId: 'vendor-1', status: 'ACTIVE' } as never,
      ]);
      await expect(
        service.acceptvendorcapacityproposal(
          request({ user: 'manager', vendorId: 'vendor-1', proposalId: 'cpr_1', body: {} }),
        ),
      ).resolves.toBeDefined();
      expect(repository.acceptProposal.mock.calls[0][0].item.history.at(-1)).toMatchObject({
        actorId: 'mgr-1',
        actorRole: 'VENDOR',
      });

      staff.listMembershipsByUserId.mockResolvedValue([
        { vendorId: 'vendor-1', status: 'INACTIVE' } as never,
      ]);
      await expect(
        service.acceptvendorcapacityproposal(
          request({ user: 'manager', vendorId: 'vendor-1', proposalId: 'cpr_1', body: {}, key: 'k2' }),
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('hides DRAFT proposals from the vendor and ignores a vendorId query override', async () => {
      repository.getProposal.mockResolvedValue(proposal({ status: 'DRAFT' }));
      await expect(
        service.getvendorcapacityproposal(request({ vendorId: 'vendor-1', proposalId: 'cpr_1' })),
      ).rejects.toThrow(NotFoundError);

      repository.listProposals.mockResolvedValue({
        items: [proposal({ status: 'DRAFT' }), proposal({ proposalId: 'cpr_2' })],
      });
      const list = await service.listvendorcapacityproposals(
        request({ vendorId: 'vendor-1', params: { vendorId: 'vendor-1' } }),
      );
      expect(list.data.items.map((item) => item.proposalId)).toEqual(['cpr_2']);
      expect(repository.listProposals.mock.calls[0][0].vendorId).toBe('vendor-1');
    });

    it('lets admins list across vendors with filters', async () => {
      repository.listProposals.mockResolvedValue({ items: [proposal()] });
      const result = await service.listcapacityproposals(
        request({ user: 'admin', params: { status: 'SENT', communityId: 'com-1', limit: '10' } }),
      );
      expect(repository.listProposals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT', communityId: 'com-1', limit: 10 }),
      );
      expect(result.data.items[0]).toHaveProperty('idempotencyKey');
      await expect(
        service.listcapacityproposals(request({ user: 'admin', params: { status: 'NOPE' } })),
      ).rejects.toThrow(ValidationError);
    });
  });
});

function createBody() {
  return {
    vendorId: 'vendor-1',
    communityId: 'com-1',
    packageScope: { serviceScopeCode: 'service:CAR_WASH', label: 'Car wash' },
    serviceWindow: WINDOW,
    quantity: 6,
    responseDeadline: '2026-11-05T00:00:00.000Z',
    proposedPayoutRate: { amountMinor: 25000, currency: 'INR' as const },
  };
}
