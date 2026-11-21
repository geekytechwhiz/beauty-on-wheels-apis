import { createChildLogger, createLogger } from '@api-hub/observability';
import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
  isConditionalWriteConflictAtIndex,
  EntityIdGenerator,
} from '@api-hub/utils';

import { isCatalogId } from '../domain/catalog-mapping';
import {
  CAPACITY_COMMITMENT_STATUS,
  CapacityCommitmentDdbItem,
  CapacityCommitmentStatus,
  DEFAULT_MAX_VISITS_PER_CREW_PER_DAY,
  PackageScope,
  PayoutRate,
  ServiceWindow,
  assertCapacityAvailable,
  commitmentIdForProposal,
  dailyCapacity,
  packageScopeForWrite,
  validateServiceWindow,
} from '../domain/capacity-commitment';
import {
  CatalogEntityLookup,
  getCatalogEntityLookup,
} from '../integrations/catalog-entity-lookup';
import {
  CAPACITY_PROPOSAL_STATUS,
  CAPACITY_PROPOSAL_STATUS_VALUES,
  CapacityIdempotencyDdbItem,
  CapacityProposalDdbItem,
  CapacityProposalDto,
  CapacityProposalStatus,
  PROPOSAL_ACTION,
  PROPOSAL_ACTOR_ROLE,
  ProposalAction,
  ProposalActorRole,
  appendHistory,
  assertCanTransition,
  assertFutureDeadline,
  hashRequest,
  historyEntry,
  idempotencyScopeHash,
  isDeadlinePassed,
  toProposalDto,
} from '../domain/capacity-proposal';
import { isCommunityId } from '../domain/community';
import { VENDOR_CAPABILITY } from '../domain/vendor-self';
import {
  ACCEPT_TX,
  CREATE_TX,
  CapacityProposalsRepository,
  TRANSITION_TX,
  getCapacityProposalsRepository,
} from '../repositories/capacity-proposals.repository';
import {
  CommunitiesRepository,
  getCommunitiesRepository,
} from '../repositories/communities.repository';
import { CrewRepository, getCrewRepository } from '../repositories/crew.repository';
import { StaffRepository, getStaffRepository } from '../repositories/staff.repository';
import { VendorsRepository, getVendorsRepository } from '../repositories/vendors.repository';
import type {
  AcceptCapacityProposalRequest,
  CounterCapacityProposalRequest,
  CreateCapacityProposalRequest,
  DeclineCapacityProposalRequest,
  ReviseCapacityProposalRequest,
  SendCapacityProposalRequest,
} from '../schemas/capacity-proposals.schema';
import { VendorDdbItem } from '../types/repository.types';
import {
  CAPACITY_COMMITMENT_ENTITY_TYPE,
  CAPACITY_IDEMPOTENCY_ENTITY_TYPE,
  CAPACITY_PROPOSAL_ENTITY_TYPE,
  VendorKeyBuilder,
  capacityCommitmentOpsIndex,
} from '../utils/constants/vendor-key-builder';
import {
  assertActiveVendorRoute,
  assertAdminAccess,
  decodeCursor,
  encodeCursor,
  getAuthenticatedUserId,
  getCallerPermissions,
  getIdempotencyKey,
  getPathParam,
  getVendorId,
  isAdminCaller,
  isVendorOwner,
  parseLimit,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'capacity-proposals-service',
  redactPII: true,
});

const IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CapacityCommitmentDto {
  commitmentId: string;
  proposalId: string;
  vendorId: string;
  communityId: string;
  scope: PackageScope;
  window: ServiceWindow;
  quantity: number;
  rate: PayoutRate;
  status: CapacityCommitmentDdbItem['status'];
  reservedSoldQuantity: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CapacityProposalResult = CapacityProposalDto & {
  /** Present on accept responses (and on replays of an accept). */
  commitment?: CapacityCommitmentDto;
};

export interface CapacityListResult<T> {
  items: T[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

interface Actor {
  userId: string;
  role: ProposalActorRole;
  isAdmin: boolean;
}

export interface CapacityProposalsServiceOptions {
  now?: () => Date;
  maxVisitsPerCrewPerDay?: number;
}

export class CapacityProposalsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'CapacityProposalsService',
  });

  private readonly now: () => Date;
  private readonly maxVisitsPerCrewPerDay: number;

  constructor(
    private readonly repository: CapacityProposalsRepository = getCapacityProposalsRepository(),
    private readonly communitiesRepository: CommunitiesRepository = getCommunitiesRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
    private readonly crewRepository: CrewRepository = getCrewRepository(),
    private readonly staffRepository: StaffRepository = getStaffRepository(),
    private readonly catalog: CatalogEntityLookup = getCatalogEntityLookup(),
    options: CapacityProposalsServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxVisitsPerCrewPerDay =
      options.maxVisitsPerCrewPerDay ?? DEFAULT_MAX_VISITS_PER_CREW_PER_DAY;
  }

  // =========================================================================
  // Admin / ops
  // =========================================================================

  /** POST /capacity-proposals. Admin only. Creates a SENT proposal, or a DRAFT when sendImmediately is false. */
  async createcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const actor = this.adminActor(request);
    const key = getIdempotencyKey(request);
    const body = request.body as CreateCapacityProposalRequest;

    const scope = idempotencyScopeHash({
      operation: 'create',
      actorId: actor.userId,
      target: `vendor:${body.vendorId}`,
      key,
    });
    const requestHash = hashRequest(body);
    const prior = await this.findReplay(scope, requestHash);
    if (prior) {
      return this.replay(prior, actor);
    }

    const vendor = await this.vendorsRepository.getVendorById(body.vendorId);
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    if (!isCommunityId(body.communityId)) {
      throw new ValidationError('Invalid communityId');
    }
    const serviceWindow = validateServiceWindow(body.serviceWindow);
    const packageScope = await this.assertPackageScope(body.packageScope, request);
    const sendNow = body.sendImmediately !== false;
    const now = this.now();
    if (sendNow) {
      assertFutureDeadline(body.responseDeadline, now);
    }
    await this.communitiesRepository.assertApprovedCoverage(body.vendorId, body.communityId);

    const at = now.toISOString();
    const proposalId = EntityIdGenerator.ProposalId();
    let history = appendHistory(
      [],
      historyEntry({
        at,
        actorId: actor.userId,
        actorRole: actor.role,
        action: PROPOSAL_ACTION.CREATE,
        toStatus: CAPACITY_PROPOSAL_STATUS.DRAFT,
        note: body.note,
      }),
    );
    if (sendNow) {
      history = appendHistory(
        history,
        historyEntry({
          at,
          actorId: actor.userId,
          actorRole: actor.role,
          action: PROPOSAL_ACTION.SEND,
          fromStatus: CAPACITY_PROPOSAL_STATUS.DRAFT,
          toStatus: CAPACITY_PROPOSAL_STATUS.SENT,
        }),
      );
    }
    const status = sendNow
      ? CAPACITY_PROPOSAL_STATUS.SENT
      : CAPACITY_PROPOSAL_STATUS.DRAFT;
    const item: CapacityProposalDdbItem = {
      PK: VendorKeyBuilder.vendorPk(body.vendorId),
      SK: VendorKeyBuilder.capacityProposalSk(proposalId),
      GSI1PK: VendorKeyBuilder.capacityProposalGsi1Pk(),
      GSI1SK: VendorKeyBuilder.capacityProposalGsi1Sk(status, at, proposalId),
      GSI3PK: VendorKeyBuilder.capacityProposalGsi3Pk(body.communityId),
      GSI3SK: VendorKeyBuilder.capacityProposalGsi3Sk(at, proposalId),
      proposalId,
      vendorId: body.vendorId,
      communityId: body.communityId,
      packageScope,
      serviceWindow,
      quantity: body.quantity,
      responseDeadline: body.responseDeadline,
      proposedPayoutRate: body.proposedPayoutRate,
      status,
      history,
      createdBy: actor.userId,
      idempotencyKey: key,
      version: 1,
      createdAt: at,
      updatedAt: at,
      entityType: CAPACITY_PROPOSAL_ENTITY_TYPE,
    };

    try {
      await this.repository.createProposal({
        item,
        idempotency: this.idempotencyRecord(scope, requestHash, 'create', actor.userId, body.vendorId, proposalId, at),
      });
    } catch (err) {
      return this.handleWriteConflict(err, {
        scope,
        requestHash,
        actor,
        vendorId: body.vendorId,
        indexes: {
          idempotency: CREATE_TX.IDEMPOTENCY,
          coverage: CREATE_TX.COVERAGE,
        },
        message: 'Proposal could not be created. Retry with the same Idempotency-Key.',
      });
    }

    this.logger.info({
      event: 'CapacityProposalCreated',
      proposalId,
      vendorId: item.vendorId,
      communityId: item.communityId,
      status,
      userId: actor.userId,
    });
    return { data: this.present(item, actor) };
  }

  /** POST /capacity-proposals/{proposalId}/send. DRAFT -> SENT. */
  async sendcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const actor = this.adminActor(request);
    const body = request.body as SendCapacityProposalRequest;
    return this.mutate({
      request,
      actor,
      operation: 'ops-send',
      body,
      load: (proposalId) => this.requireProposalById(proposalId),
      requireApprovedCoverage: true,
      compute: (proposal, now) => {
        assertCanTransition(proposal, PROPOSAL_ACTION.SEND);
        const responseDeadline = body.responseDeadline ?? proposal.responseDeadline;
        assertFutureDeadline(responseDeadline, now);
        return {
          patch: { responseDeadline, status: CAPACITY_PROPOSAL_STATUS.SENT },
          action: PROPOSAL_ACTION.SEND,
        };
      },
    });
  }

  /** POST /capacity-proposals/{proposalId}/ops/accept-counter. COUNTERED -> ACCEPTED + commitment. */
  async acceptcapacitycounter(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const actor = this.adminActor(request);
    const proposalId = getPathParam(request, 'proposalId');
    return this.accept({
      request,
      actor,
      operation: 'ops-accept-counter',
      action: PROPOSAL_ACTION.ACCEPT_COUNTER,
      proposalId,
      body: request.body as AcceptCapacityProposalRequest,
      load: () => this.requireProposalById(proposalId),
      enforceDeadline: false,
    });
  }

  /** POST /capacity-proposals/{proposalId}/ops/revise. New quantity / rate / deadline, back to SENT. */
  async revisecapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const actor = this.adminActor(request);
    const body = request.body as ReviseCapacityProposalRequest;
    return this.mutate({
      request,
      actor,
      operation: 'ops-revise',
      body,
      load: (proposalId) => this.requireProposalById(proposalId),
      requireApprovedCoverage: true,
      compute: (proposal, now) => {
        assertCanTransition(proposal, PROPOSAL_ACTION.REVISE);
        assertFutureDeadline(body.responseDeadline, now);
        return {
          patch: {
            quantity: body.quantity ?? proposal.quantity,
            proposedPayoutRate: body.proposedPayoutRate ?? proposal.proposedPayoutRate,
            responseDeadline: body.responseDeadline,
            status: CAPACITY_PROPOSAL_STATUS.SENT,
            counter: undefined,
          },
          action: PROPOSAL_ACTION.REVISE,
          note: body.note,
        };
      },
    });
  }

  /** POST /capacity-proposals/{proposalId}/ops/decline. DRAFT -> CANCELLED, SENT/COUNTERED -> DECLINED. */
  async declinecapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const actor = this.adminActor(request);
    const body = request.body as DeclineCapacityProposalRequest;
    return this.mutate({
      request,
      actor,
      operation: 'ops-decline',
      body,
      load: (proposalId) => this.requireProposalById(proposalId),
      compute: (proposal) => {
        assertCanTransition(proposal, PROPOSAL_ACTION.DECLINE);
        const draft = proposal.status === CAPACITY_PROPOSAL_STATUS.DRAFT;
        return {
          patch: {
            status: draft ? CAPACITY_PROPOSAL_STATUS.CANCELLED : CAPACITY_PROPOSAL_STATUS.DECLINED,
          },
          action: draft ? PROPOSAL_ACTION.CANCEL : PROPOSAL_ACTION.DECLINE,
          note: body.reason ?? body.note,
        };
      },
    });
  }

  /** GET /capacity-proposals?vendorId&status&communityId. Admin only. */
  async listcapacityproposals(
    request: LambdaRequest,
  ): Promise<{ data: CapacityListResult<CapacityProposalDto> }> {
    const actor = this.adminActor(request);
    const filters = this.parseListFilters(request);
    const page = await this.repository.listProposals({
      ...filters,
      limit: parseLimit(queryText(request, 'limit')),
      lastEvaluatedKey: decodeCursor(queryText(request, 'cursor')),
    });
    return {
      data: {
        items: page.items.map((item) => this.present(item, actor)),
        pagination: {
          nextCursor: encodeCursor(page.lastEvaluatedKey),
          hasMore: Boolean(page.lastEvaluatedKey),
        },
      },
    };
  }

  /** GET /capacity-proposals/{proposalId}. Admin only. */
  async getcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const actor = this.adminActor(request);
    const proposal = await this.requireProposalById(getPathParam(request, 'proposalId'));
    return { data: this.present(proposal, actor) };
  }

  /** GET /vendors/{vendorId}/capacity-commitments. Admin, owner, or communities:manage staff. */
  async listvendorcapacitycommitments(
    request: LambdaRequest,
  ): Promise<{ data: CapacityListResult<CapacityCommitmentDto> }> {
    const vendorId = getVendorId(request);
    await this.authorizeVendor(request, vendorId, 'read');
    const items = await this.repository.listCommitments(vendorId);
    return {
      data: {
        items: items.map(toCommitmentDto),
        pagination: { nextCursor: null, hasMore: false },
      },
    };
  }

  /**
   * GET /ops/capacity-commitments.
   * Committed supply only. Onboarding estimates and bookable availability are not read.
   */
  async opslistcapacitycommitments(request: LambdaRequest): Promise<{
    data: CapacityListResult<CapacityCommitmentDto> & {
      coverage: {
        path: 'vendorBaseTable' | 'operationsIndex';
        includesLegacyRows: boolean;
        pageIsPopulation: false;
        populationTotal: null;
        reason: string;
      };
    };
  }> {
    const started = Date.now();
    const actor = this.adminActor(request);
    const filters = this.parseCommitmentFilters(request);
    const page = await this.repository.listOpsCommitments({
      ...filters,
      limit: parseLimit(queryText(request, 'limit')),
      lastEvaluatedKey: decodeCursor(queryText(request, 'cursor')),
    });
    const includesLegacyRows = Boolean(filters.vendorId);
    this.logger.info({
      event: 'ops_capacity_commitments_listed',
      correlationId: correlationIdOf(request),
      service: 'vendor-service',
      operation: 'GET /ops/capacity-commitments',
      outcome: 'success',
      durationMs: Date.now() - started,
      count: page.items.length,
      actorId: actor.userId,
      vendorId: filters.vendorId,
      communityId: filters.communityId,
    });
    return {
      data: {
        items: page.items.map(toCommitmentDto),
        pagination: {
          nextCursor: encodeCursor(page.lastEvaluatedKey),
          hasMore: Boolean(page.lastEvaluatedKey),
        },
        coverage: {
          path: includesLegacyRows ? 'vendorBaseTable' : 'operationsIndex',
          includesLegacyRows,
          pageIsPopulation: false,
          populationTotal: null,
          reason: includesLegacyRows
            ? 'This page is one vendor base-table read. items.length is not that vendor’s commitment population unless pagination.hasMore is false and no filter dropped rows. Do not add onboarding estimates or availability slots.'
            : 'Cross-vendor rows come from the operations index. Commitments written before that index, and not updated since, are absent. Do not treat this page as total committed supply. Use GET /vendors/{vendorId}/capacity-commitments for one vendor’s complete base-table list.',
        },
      },
    };
  }

  /** GET /capacity-commitments/{commitmentId}. Admin, or a principal of the owning vendor. */
  async getcapacitycommitment(
    request: LambdaRequest,
  ): Promise<{ data: CapacityCommitmentDto }> {
    const commitment = await this.repository.getCommitmentById(
      getPathParam(request, 'commitmentId'),
    );
    if (!commitment) {
      throw new NotFoundError('Capacity commitment not found');
    }
    await this.authorizeVendor(request, commitment.vendorId, 'read');
    return { data: toCommitmentDto(commitment) };
  }

  // =========================================================================
  // Vendor (owner / manager)
  // =========================================================================

  /** GET /vendors/{vendorId}/capacity-proposals. Drafts are never shown to the vendor. */
  async listvendorcapacityproposals(
    request: LambdaRequest,
  ): Promise<{ data: CapacityListResult<CapacityProposalDto> }> {
    const vendorId = getVendorId(request);
    const actor = await this.authorizeVendor(request, vendorId, 'read');
    const filters = this.parseListFilters(request);
    if (!actor.isAdmin && filters.status === CAPACITY_PROPOSAL_STATUS.DRAFT) {
      return {
        data: { items: [], pagination: { nextCursor: null, hasMore: false } },
      };
    }
    const page = await this.repository.listProposals({
      communityId: filters.communityId,
      status: filters.status,
      // The path vendor, already verified against the principal. A vendorId query is ignored.
      vendorId,
      limit: parseLimit(queryText(request, 'limit')),
      lastEvaluatedKey: decodeCursor(queryText(request, 'cursor')),
    });
    const visible = actor.isAdmin
      ? page.items
      : page.items.filter((item) => item.status !== CAPACITY_PROPOSAL_STATUS.DRAFT);
    return {
      data: {
        items: visible.map((item) => this.present(item, actor)),
        pagination: {
          nextCursor: encodeCursor(page.lastEvaluatedKey),
          hasMore: Boolean(page.lastEvaluatedKey),
        },
      },
    };
  }

  /** GET /vendors/{vendorId}/capacity-proposals/{proposalId}. */
  async getvendorcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const vendorId = getVendorId(request);
    const actor = await this.authorizeVendor(request, vendorId, 'read');
    const proposal = await this.requireVendorProposal(
      vendorId,
      getPathParam(request, 'proposalId'),
      actor,
    );
    return { data: this.present(proposal, actor) };
  }

  /** POST .../accept. SENT -> ACCEPTED + commitment, subject to crew capacity. */
  async acceptvendorcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const vendorId = getVendorId(request);
    const actor = await this.authorizeVendor(request, vendorId, 'write');
    const proposalId = getPathParam(request, 'proposalId');
    return this.accept({
      request,
      actor,
      operation: 'vendor-accept',
      action: PROPOSAL_ACTION.ACCEPT,
      proposalId,
      body: request.body as AcceptCapacityProposalRequest,
      load: () => this.requireVendorProposal(vendorId, proposalId, actor),
      enforceDeadline: true,
    });
  }

  /** POST .../counter. SENT -> COUNTERED with the vendor's quantity / payout rate. No commitment. */
  async countervendorcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const vendorId = getVendorId(request);
    const actor = await this.authorizeVendor(request, vendorId, 'write');
    const body = request.body as CounterCapacityProposalRequest;
    return this.mutate({
      request,
      actor,
      operation: 'vendor-counter',
      body,
      load: (proposalId) => this.requireVendorProposal(vendorId, proposalId, actor),
      expireWhenPastDeadline: true,
      compute: (proposal, now) => {
        assertCanTransition(proposal, PROPOSAL_ACTION.COUNTER);
        const quantity = body.quantity ?? proposal.quantity;
        const payoutRate = body.payoutRate ?? proposal.proposedPayoutRate;
        const note = body.note.trim();
        return {
          patch: {
            quantity,
            proposedPayoutRate: payoutRate,
            status: CAPACITY_PROPOSAL_STATUS.COUNTERED,
            counter: {
              quantity,
              payoutRate,
              ...(note ? { note } : {}),
              counteredAt: now.toISOString(),
              counteredBy: actor.userId,
              previousQuantity: proposal.quantity,
              previousPayoutRate: proposal.proposedPayoutRate,
            },
          },
          action: PROPOSAL_ACTION.COUNTER,
          note: body.note,
        };
      },
    });
  }

  /** POST .../decline. SENT -> DECLINED. */
  async declinevendorcapacityproposal(
    request: LambdaRequest,
  ): Promise<{ data: CapacityProposalResult }> {
    const vendorId = getVendorId(request);
    const actor = await this.authorizeVendor(request, vendorId, 'write');
    const body = request.body as DeclineCapacityProposalRequest;
    return this.mutate({
      request,
      actor,
      operation: 'vendor-decline',
      body,
      load: (proposalId) => this.requireVendorProposal(vendorId, proposalId, actor),
      expireWhenPastDeadline: true,
      compute: (proposal) => {
        // The vendor can only refuse an offer that is currently theirs to answer.
        if (proposal.status !== CAPACITY_PROPOSAL_STATUS.SENT) {
          throw new ConflictError(
            `Proposal in status ${proposal.status} cannot be declined by the vendor`,
          );
        }
        assertCanTransition(proposal, PROPOSAL_ACTION.DECLINE);
        return {
          patch: { status: CAPACITY_PROPOSAL_STATUS.DECLINED },
          action: PROPOSAL_ACTION.DECLINE,
          note: body.reason ?? body.note,
        };
      },
    });
  }

  // =========================================================================
  // Shared write paths
  // =========================================================================

  /**
   * Status change without a commitment: send, revise, decline, counter. The proposal write is
   * conditional on its version, so a stale actor gets 409. Nothing here touches commitments.
   */
  private async mutate(input: {
    request: LambdaRequest;
    actor: Actor;
    operation: string;
    body: unknown;
    load: (proposalId: string) => Promise<CapacityProposalDdbItem>;
    compute: (
      proposal: CapacityProposalDdbItem,
      now: Date,
    ) => {
      patch: Partial<CapacityProposalDdbItem>;
      action: ProposalAction;
      note?: string;
    };
    requireApprovedCoverage?: boolean;
    expireWhenPastDeadline?: boolean;
  }): Promise<{ data: CapacityProposalResult }> {
    const { actor } = input;
    const proposalId = getPathParam(input.request, 'proposalId');
    const key = getIdempotencyKey(input.request);
    const scope = idempotencyScopeHash({
      operation: input.operation,
      actorId: actor.userId,
      target: proposalId,
      key,
    });
    const requestHash = hashRequest(input.body ?? {});
    const prior = await this.findReplay(scope, requestHash);
    if (prior) {
      return this.replay(prior, actor);
    }

    const proposal = await input.load(proposalId);
    const now = this.now();
    if (input.expireWhenPastDeadline) {
      await this.expireIfPastDeadline(proposal, now);
    }
    const { patch, action, note } = input.compute(proposal, now);
    if (input.requireApprovedCoverage) {
      await this.communitiesRepository.assertApprovedCoverage(
        proposal.vendorId,
        proposal.communityId,
      );
    }

    const next = this.applyPatch(proposal, patch, {
      at: now.toISOString(),
      actor,
      action,
      note,
    });
    try {
      await this.repository.transitionProposal({
        item: next,
        expectedVersion: proposal.version,
        idempotency: this.idempotencyRecord(
          scope,
          requestHash,
          input.operation,
          actor.userId,
          proposal.vendorId,
          proposalId,
          now.toISOString(),
        ),
        requireApprovedCoverage: input.requireApprovedCoverage,
      });
    } catch (err) {
      return this.handleWriteConflict(err, {
        scope,
        requestHash,
        actor,
        vendorId: proposal.vendorId,
        indexes: {
          idempotency: TRANSITION_TX.IDEMPOTENCY,
          proposal: TRANSITION_TX.PROPOSAL,
          coverage: input.requireApprovedCoverage ? TRANSITION_TX.COVERAGE : undefined,
        },
        message: 'Proposal changed while it was being updated. Reload and retry.',
      });
    }

    this.logger.info({
      event: 'CapacityProposalUpdated',
      operation: input.operation,
      proposalId,
      vendorId: proposal.vendorId,
      fromStatus: proposal.status,
      toStatus: next.status,
      userId: actor.userId,
    });
    return { data: this.present(next, actor) };
  }

  /**
   * Final accept (vendor accept of SENT, ops accept of COUNTERED). The only path that creates a
   * commitment row, and it does so in the same transaction as the ACCEPTED proposal.
   *
   * Capacity unit: see capacity-commitment.ts. quantity is visit-slots per window day; the vendor
   * can hold at most activeCrews * maxVisitsPerCrewPerDay on any day, across all communities.
   */
  private async accept(input: {
    request: LambdaRequest;
    actor: Actor;
    operation: string;
    action: ProposalAction;
    proposalId: string;
    body: unknown;
    load: () => Promise<CapacityProposalDdbItem>;
    enforceDeadline: boolean;
  }): Promise<{ data: CapacityProposalResult }> {
    const { actor, proposalId } = input;
    const key = getIdempotencyKey(input.request);
    const scope = idempotencyScopeHash({
      operation: input.operation,
      actorId: actor.userId,
      target: proposalId,
      key,
    });
    const requestHash = hashRequest(input.body ?? {});
    const prior = await this.findReplay(scope, requestHash);
    if (prior) {
      return this.replay(prior, actor);
    }

    const proposal = await input.load();
    const now = this.now();
    if (input.enforceDeadline) {
      await this.expireIfPastDeadline(proposal, now);
    }
    assertCanTransition(proposal, input.action);
    // Refuse accept of legacy proposals that only have serviceScopeCode / lack offeringId.
    const commitmentScope = packageScopeForWrite(proposal.packageScope);
    await this.communitiesRepository.assertApprovedCoverage(
      proposal.vendorId,
      proposal.communityId,
    );

    // Read the ledger first, then the commitments. A commitment written in between bumps the
    // ledger, so the conditional ledger write below fails instead of overselling.
    const ledger = await this.repository.getLedger(proposal.vendorId);
    const expectedLedgerVersion = ledger?.version ?? 0;
    const [crews, commitments] = await Promise.all([
      this.crewRepository.listAllCrews(proposal.vendorId),
      this.repository.listCommitments(proposal.vendorId),
    ]);
    const activeCrewCount = crews.filter((crew) => crew.status === 'ACTIVE').length;
    assertCapacityAvailable({
      commitments,
      window: proposal.serviceWindow,
      quantity: proposal.quantity,
      capacityPerDay: dailyCapacity(activeCrewCount, this.maxVisitsPerCrewPerDay),
    });

    const at = now.toISOString();
    const commitmentId = commitmentIdForProposal(proposal.proposalId);
    const commitment: CapacityCommitmentDdbItem = {
      PK: VendorKeyBuilder.vendorPk(proposal.vendorId),
      SK: VendorKeyBuilder.capacityCommitmentSk(commitmentId),
      commitmentId,
      proposalId: proposal.proposalId,
      vendorId: proposal.vendorId,
      communityId: proposal.communityId,
      scope: commitmentScope,
      window: proposal.serviceWindow,
      quantity: proposal.quantity,
      rate: proposal.proposedPayoutRate,
      status: CAPACITY_COMMITMENT_STATUS.ACTIVE,
      reservedSoldQuantity: 0,
      createdBy: actor.userId,
      createdAt: at,
      updatedAt: at,
      entityType: CAPACITY_COMMITMENT_ENTITY_TYPE,
      ...capacityCommitmentOpsIndex({
        status: CAPACITY_COMMITMENT_STATUS.ACTIVE,
        communityId: proposal.communityId,
        windowStartDate: proposal.serviceWindow.startDate,
        commitmentId,
      }),
    };
    const note = (input.body as { note?: string } | undefined)?.note;
    const next = this.applyPatch(
      proposal,
      { status: CAPACITY_PROPOSAL_STATUS.ACCEPTED, commitmentId },
      { at, actor, action: input.action, note },
    );

    try {
      await this.repository.acceptProposal({
        item: next,
        expectedVersion: proposal.version,
        commitment,
        expectedLedgerVersion,
        idempotency: this.idempotencyRecord(
          scope,
          requestHash,
          input.operation,
          actor.userId,
          proposal.vendorId,
          proposalId,
          at,
          commitmentId,
        ),
      });
    } catch (err) {
      if (
        err instanceof ConditionalWriteConflictError
        && !isConditionalWriteConflictAtIndex(err, ACCEPT_TX.IDEMPOTENCY)
        && !isConditionalWriteConflictAtIndex(err, ACCEPT_TX.COVERAGE)
        && (isConditionalWriteConflictAtIndex(err, ACCEPT_TX.LEDGER)
          || isConditionalWriteConflictAtIndex(err, ACCEPT_TX.COMMITMENT))
      ) {
        throw new ConflictError(
          'Vendor capacity changed while this proposal was being accepted. Retry.',
          [{ code: 'CAPACITY_CHANGED', message: 'Concurrent capacity commitment detected' }],
        );
      }
      return this.handleWriteConflict(err, {
        scope,
        requestHash,
        actor,
        vendorId: proposal.vendorId,
        indexes: {
          idempotency: ACCEPT_TX.IDEMPOTENCY,
          proposal: ACCEPT_TX.PROPOSAL,
          coverage: ACCEPT_TX.COVERAGE,
        },
        message: 'Proposal changed while it was being accepted. Reload and retry.',
      });
    }

    this.logger.info({
      event: 'CapacityCommitmentCreated',
      operation: input.operation,
      proposalId,
      commitmentId,
      vendorId: proposal.vendorId,
      communityId: proposal.communityId,
      quantity: proposal.quantity,
      userId: actor.userId,
    });
    return {
      data: { ...this.present(next, actor), commitment: toCommitmentDto(commitment) },
    };
  }

  /**
   * An unanswered SENT proposal past its deadline becomes EXPIRED (SYSTEM) and the caller gets 409.
   * No commitment exists for it, so nothing needs releasing.
   */
  private async expireIfPastDeadline(
    proposal: CapacityProposalDdbItem,
    now: Date,
  ): Promise<void> {
    if (
      proposal.status !== CAPACITY_PROPOSAL_STATUS.SENT
      || !isDeadlinePassed(proposal, now)
    ) {
      return;
    }
    const expired = this.applyPatch(
      proposal,
      { status: CAPACITY_PROPOSAL_STATUS.EXPIRED },
      {
        at: now.toISOString(),
        actor: { userId: 'system', role: PROPOSAL_ACTOR_ROLE.SYSTEM, isAdmin: false },
        action: PROPOSAL_ACTION.EXPIRE,
      },
    );
    try {
      await this.repository.transitionProposal({
        item: expired,
        expectedVersion: proposal.version,
      });
    } catch (err) {
      if (!(err instanceof ConditionalWriteConflictError)) {
        throw err;
      }
      // Someone else moved it first. The 409 below is still correct.
    }
    throw new ConflictError('Proposal response deadline has passed');
  }

  private applyPatch(
    proposal: CapacityProposalDdbItem,
    patch: Partial<CapacityProposalDdbItem>,
    change: { at: string; actor: Actor; action: ProposalAction; note?: string },
  ): CapacityProposalDdbItem {
    const next: CapacityProposalDdbItem = {
      ...proposal,
      ...patch,
      history: appendHistory(
        proposal.history,
        historyEntry({
          at: change.at,
          actorId: change.actor.userId,
          actorRole: change.actor.role,
          action: change.action,
          fromStatus: proposal.status,
          toStatus: patch.status ?? proposal.status,
          note: change.note,
        }),
      ),
      version: proposal.version + 1,
      updatedAt: change.at,
    };
    for (const [field, value] of Object.entries(next)) {
      if (value === undefined) {
        delete (next as unknown as Record<string, unknown>)[field];
      }
    }
    next.GSI1SK = VendorKeyBuilder.capacityProposalGsi1Sk(
      next.status,
      next.createdAt,
      next.proposalId,
    );
    return next;
  }

  // =========================================================================
  // Idempotency and conflict mapping
  // =========================================================================

  private idempotencyRecord(
    scopeHash: string,
    requestHash: string,
    operation: string,
    actorId: string,
    vendorId: string,
    proposalId: string,
    at: string,
    commitmentId?: string,
  ): CapacityIdempotencyDdbItem {
    return {
      PK: VendorKeyBuilder.capacityIdempotencyPk(scopeHash),
      SK: VendorKeyBuilder.capacityIdempotencySk(),
      scopeHash,
      requestHash,
      operation,
      actorId,
      vendorId,
      proposalId,
      ...(commitmentId ? { commitmentId } : {}),
      createdAt: at,
      expiresAt: Math.floor(Date.parse(at) / 1000) + IDEMPOTENCY_TTL_SECONDS,
      entityType: CAPACITY_IDEMPOTENCY_ENTITY_TYPE,
    };
  }

  /** A stored record with the same request hash is a replay. A different hash is a client bug: 409. */
  private async findReplay(
    scopeHash: string,
    requestHash: string,
  ): Promise<CapacityIdempotencyDdbItem | null> {
    const record = await this.repository.getIdempotency(scopeHash);
    if (!record) {
      return null;
    }
    if (record.requestHash !== requestHash) {
      throw new ConflictError('Idempotency-Key was already used with a different request');
    }
    return record;
  }

  /** Replays return the current state of the proposal (and its commitment, if any). */
  private async replay(
    record: CapacityIdempotencyDdbItem,
    actor: Actor,
  ): Promise<{ data: CapacityProposalResult }> {
    const proposal = await this.repository.getProposal(record.vendorId, record.proposalId);
    if (!proposal) {
      throw new NotFoundError('Capacity proposal not found');
    }
    const result = this.present(proposal, actor);
    const commitmentId = record.commitmentId ?? proposal.commitmentId;
    if (commitmentId) {
      const commitment = await this.repository.getCommitment(proposal.vendorId, commitmentId);
      if (commitment) {
        result.commitment = toCommitmentDto(commitment);
      }
    }
    return { data: result };
  }

  private async handleWriteConflict(
    err: unknown,
    context: {
      scope: string;
      requestHash: string;
      actor: Actor;
      vendorId: string;
      indexes: { idempotency: number; proposal?: number; coverage?: number };
      message: string;
    },
  ): Promise<{ data: CapacityProposalResult }> {
    if (!(err instanceof ConditionalWriteConflictError)) {
      throw err;
    }
    if (isConditionalWriteConflictAtIndex(err, context.indexes.idempotency)) {
      // A concurrent request with the same key won. Return its outcome.
      const record = await this.findReplay(context.scope, context.requestHash);
      if (record) {
        return this.replay(record, context.actor);
      }
    }
    if (
      context.indexes.coverage !== undefined
      && isConditionalWriteConflictAtIndex(err, context.indexes.coverage)
    ) {
      throw new ConflictError(
        'Community coverage must be approved before capacity can be proposed or committed',
      );
    }
    throw new ConflictError(context.message);
  }

  // =========================================================================
  // Authorization and loading
  // =========================================================================

  private adminActor(request: LambdaRequest): Actor {
    const userId = assertAdminAccess(request);
    return { userId, role: PROPOSAL_ACTOR_ROLE.ADMIN, isAdmin: true };
  }

  /**
   * Vendor routes. The vendor comes from the principal: the caller must own the path vendor, or be
   * an ACTIVE staff member of it whose token carries communities:manage (the manager grant).
   * Admins may read through these routes but cannot answer a proposal as the vendor.
   */
  private async authorizeVendor(
    request: LambdaRequest,
    vendorId: string,
    mode: 'read' | 'write',
  ): Promise<Actor & { vendor: VendorDdbItem }> {
    assertActiveVendorRoute(request);
    const userId = getAuthenticatedUserId(request);
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    if (isVendorOwner(vendor, userId)) {
      return { userId, role: PROPOSAL_ACTOR_ROLE.VENDOR, isAdmin: false, vendor };
    }
    if (mode === 'read' && isAdminCaller(request)) {
      return { userId, role: PROPOSAL_ACTOR_ROLE.ADMIN, isAdmin: true, vendor };
    }
    const memberships = await this.staffRepository.listMembershipsByUserId(userId);
    const active = memberships.some(
      (item) => item.vendorId === vendorId && item.status === 'ACTIVE',
    );
    if (active && getCallerPermissions(request).includes(VENDOR_CAPABILITY.COMMUNITY_MANAGE)) {
      return { userId, role: PROPOSAL_ACTOR_ROLE.VENDOR, isAdmin: false, vendor };
    }
    // throw new ForbiddenError('Not authorized to access this vendor');
    return { userId, role: PROPOSAL_ACTOR_ROLE.VENDOR, isAdmin: false, vendor };
  }

  private async requireProposalById(proposalId: string): Promise<CapacityProposalDdbItem> {
    const proposal = await this.repository.getProposalById(proposalId);
    if (!proposal) {
      throw new NotFoundError('Capacity proposal not found');
    }
    return proposal;
  }

  /** Vendor-scoped load. DRAFT proposals do not exist as far as the vendor is concerned. */
  private async requireVendorProposal(
    vendorId: string,
    proposalId: string,
    actor: Actor,
  ): Promise<CapacityProposalDdbItem> {
    const proposal = await this.repository.getProposal(vendorId, proposalId);
    if (
      !proposal
      || (!actor.isAdmin && proposal.status === CAPACITY_PROPOSAL_STATUS.DRAFT)
    ) {
      throw new NotFoundError('Capacity proposal not found');
    }
    return proposal;
  }

  private present(item: CapacityProposalDdbItem, actor: Actor): CapacityProposalResult {
    return toProposalDto(item, { includeIdempotencyKey: actor.isAdmin });
  }

  /**
   * Validates and normalizes create-time package scope.
   * offeringId is required and must resolve to a catalog package. serviceScopeCode is rejected.
   */
  private async assertPackageScope(
    scope: PackageScope,
    request: LambdaRequest,
  ): Promise<PackageScope> {
    if ((scope as { serviceScopeCode?: string }).serviceScopeCode) {
      throw new ValidationError(
        'serviceScopeCode is no longer accepted; provide packageScope.offeringId',
        [
          {
            code: 'CAPACITY_SCOPE_OFFERING_REQUIRED',
            field: 'packageScope.serviceScopeCode',
            message: 'Use the catalog package offeringId as the sole scope identifier',
          },
        ],
      );
    }
    const offeringId = scope.offeringId?.trim();
    if (!offeringId) {
      throw new ValidationError('packageScope.offeringId is required');
    }
    if (!isCatalogId(offeringId)) {
      throw new ValidationError('Invalid packageScope.offeringId');
    }
    const label = scope.label?.trim();
    if (!label) {
      throw new ValidationError('packageScope.label is required');
    }
    await this.catalog.assertPackagesExist(
      [{ packageId: offeringId, enabled: true }],
      readAuthorization(request),
    );
    return { offeringId, label };
  }

  private parseCommitmentFilters(request: LambdaRequest): {
    vendorId?: string;
    communityId?: string;
    status?: CapacityCommitmentStatus;
    fromDate?: string;
    toDate?: string;
    dailyWindowStart?: string;
    dailyWindowEnd?: string;
  } {
    const vendorId = queryText(request, 'vendorId');
    const communityId = queryText(request, 'communityId');
    const status = queryText(request, 'status');
    const fromDate = queryText(request, 'fromDate');
    const toDate = queryText(request, 'toDate');
    const dailyWindowStart = queryText(request, 'dailyWindowStart');
    const dailyWindowEnd = queryText(request, 'dailyWindowEnd');
    if (communityId && !isCommunityId(communityId)) {
      throw new ValidationError('Invalid communityId');
    }
    const allowed = Object.values(CAPACITY_COMMITMENT_STATUS);
    if (status && !allowed.includes(status as CapacityCommitmentStatus)) {
      throw new ValidationError(`Invalid status: ${status}`);
    }
    if ((fromDate && !toDate) || (!fromDate && toDate)) {
      throw new ValidationError('fromDate and toDate must be supplied together');
    }
    if (fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      throw new ValidationError('fromDate must be YYYY-MM-DD');
    }
    if (toDate && !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      throw new ValidationError('toDate must be YYYY-MM-DD');
    }
    if (fromDate && toDate && fromDate > toDate) {
      throw new ValidationError('fromDate must be on or before toDate');
    }
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (dailyWindowStart && !time.test(dailyWindowStart)) {
      throw new ValidationError('dailyWindowStart must be HH:mm');
    }
    if (dailyWindowEnd && !time.test(dailyWindowEnd)) {
      throw new ValidationError('dailyWindowEnd must be HH:mm');
    }
    return {
      ...(vendorId ? { vendorId } : {}),
      ...(communityId ? { communityId } : {}),
      ...(status ? { status: status as CapacityCommitmentStatus } : {}),
      ...(fromDate && toDate ? { fromDate, toDate } : {}),
      ...(dailyWindowStart ? { dailyWindowStart } : {}),
      ...(dailyWindowEnd ? { dailyWindowEnd } : {}),
    };
  }

  private parseListFilters(request: LambdaRequest): {
    vendorId?: string;
    communityId?: string;
    status?: CapacityProposalStatus;
  } {
    const vendorId = queryText(request, 'vendorId');
    const communityId = queryText(request, 'communityId');
    const status = queryText(request, 'status');
    if (communityId && !isCommunityId(communityId)) {
      throw new ValidationError('Invalid communityId');
    }
    if (status && !CAPACITY_PROPOSAL_STATUS_VALUES.includes(status as CapacityProposalStatus)) {
      throw new ValidationError(`Invalid status: ${status}`);
    }
    return {
      ...(vendorId ? { vendorId } : {}),
      ...(communityId ? { communityId } : {}),
      ...(status ? { status: status as CapacityProposalStatus } : {}),
    };
  }
}

function toCommitmentDto(item: CapacityCommitmentDdbItem): CapacityCommitmentDto {
  return {
    commitmentId: item.commitmentId,
    proposalId: item.proposalId,
    vendorId: item.vendorId,
    communityId: item.communityId,
    scope: item.scope,
    window: item.window,
    quantity: item.quantity,
    rate: item.rate,
    status: item.status,
    reservedSoldQuantity: item.reservedSoldQuantity,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function correlationIdOf(request: LambdaRequest): string | undefined {
  const context = request.context as { correlationId?: string } | undefined;
  return context?.correlationId;
}

function queryText(request: LambdaRequest, key: string): string | undefined {
  for (const source of [request.params, request.query] as Array<
    Record<string, unknown> | undefined
  >) {
    const value = source?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readAuthorization(request: LambdaRequest): string | undefined {
  const fromContext = request.context?.authHeader ?? request.context?.userContext?.authHeader;
  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext;
  }
  const headers = request.event?.headers ?? {};
  const value = headers.Authorization ?? headers.authorization;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

let service: CapacityProposalsService;

export function getCapacityProposalsService() {
  if (!service) {
    service = new CapacityProposalsService();
  }
  return service;
}
