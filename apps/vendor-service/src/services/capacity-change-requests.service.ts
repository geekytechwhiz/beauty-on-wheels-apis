import { createHash, randomUUID } from 'crypto';

import {
  BaseError,
  ConditionalWriteConflictError,
  ConflictError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  CAPACITY_CHANGE_STATUS,
  CHANGEABLE_COMMITMENT_STATUSES,
  CapacityChangeRequestDdbItem,
  CapacityChangeRequestResponse,
  CapacityChangeStatus,
  ChangeAwareCommitment,
  capacityChangeKeys,
  evaluateApproval,
  toChangeResponse,
} from '../domain/capacity-change';
import {
  CAPACITY_COMMITMENT_STATUS,
  CapacityCommitmentDdbItem,
  assertCapacityAvailable,
  dailyCapacity,
} from '../domain/capacity-commitment';
import {
  CapacityChangeRequestsRepository,
  CHANGE_CREATE_TX,
  getCapacityChangeRequestsRepository,
} from '../repositories/capacity-change-requests.repository';
import {
  CapacityProposalsRepository,
  getCapacityProposalsRepository,
} from '../repositories/capacity-proposals.repository';
import { CrewRepository, getCrewRepository } from '../repositories/crew.repository';
import { VendorsRepository, getVendorsRepository } from '../repositories/vendors.repository';
import {
  ApproveCapacityChangeSchema,
  CreateCapacityChangeRequestSchema,
  RejectCapacityChangeSchema,
  parseBody,
} from '../schemas/capacity-change-requests.schema';
import { assertAdminAccess } from '../utils/helpers/authorization';
import { assertVendorManager } from '../utils/helpers/vendor-manager';
import { getIdempotencyKey, getPathParam, getVendorId } from '../utils/helpers/vendor-request';

const baseLogger = createLogger({ service: 'capacity-change-requests', redactPII: true });

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function conflict(code: string, message: string): BaseError {
  return new BaseError(message, 409, code, undefined, { retryable: false });
}

/**
 * Capacity-change requests are a separate resource from issues. While one is PENDING the
 * commitment is CHANGE_PENDING and its quantity is unchanged. Only an admin approval moves
 * the quantity, and only after the sold obligations are checked.
 */
export class CapacityChangeRequestsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'CapacityChangeRequestsService' });

  constructor(
    private readonly requests: CapacityChangeRequestsRepository = getCapacityChangeRequestsRepository(),
    private readonly capacity: Pick<CapacityProposalsRepository, 'getCommitment' | 'getLedger' | 'listCommitments'> = getCapacityProposalsRepository(),
    private readonly vendors: Pick<VendorsRepository, 'getVendorById'> = getVendorsRepository(),
    private readonly crews: Pick<CrewRepository, 'listAllCrews'> = getCrewRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(request: LambdaRequest): Promise<CapacityChangeRequestResponse> {
    const vendorId = getVendorId(request);
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor not found');
    const { userId, isAdmin } = assertVendorManager(request, vendor);
    const key = getIdempotencyKey(request);
    const body = parseBody(CreateCapacityChangeRequestSchema, request.body);

    const requestHash = hashOf({ vendorId, ...body });
    const existing = await this.requests.getIdempotency(vendorId, key);
    if (existing) return this.replay(existing, requestHash);

    const commitment = await this.capacity.getCommitment(vendorId, body.commitmentId) as ChangeAwareCommitment | null;
    if (!commitment) throw new NotFoundError('Capacity commitment not found');
    if (commitment.status === CAPACITY_COMMITMENT_STATUS.CHANGE_PENDING || commitment.pendingChangeRequestId) {
      throw conflict('CHANGE_ALREADY_PENDING', 'This commitment already has a pending change request');
    }
    if (!CHANGEABLE_COMMITMENT_STATUSES.includes(commitment.status)) {
      throw conflict('COMMITMENT_NOT_CHANGEABLE', `A ${commitment.status} commitment cannot be changed`);
    }
    if (body.requestedQuantity === commitment.quantity) {
      throw new ValidationError('requestedQuantity equals the current quantity');
    }

    const nowIso = this.now().toISOString();
    const requestId = randomUUID();
    const item: CapacityChangeRequestDdbItem = {
      PK: capacityChangeKeys.pk(vendorId),
      SK: capacityChangeKeys.sk(requestId),
      GSI1PK: capacityChangeKeys.gsi1Pk(),
      GSI1SK: capacityChangeKeys.gsi1Sk(CAPACITY_CHANGE_STATUS.PENDING, nowIso, requestId),
      requestId,
      vendorId,
      commitmentId: commitment.commitmentId,
      currentQuantity: commitment.quantity,
      requestedQuantity: body.requestedQuantity,
      reason: body.reason,
      status: CAPACITY_CHANGE_STATUS.PENDING,
      commitmentStatusBefore: commitment.status,
      createdBy: userId,
      history: [{
        at: nowIso,
        actorId: userId,
        actorRole: isAdmin ? 'ADMIN' : 'VENDOR',
        action: 'REQUESTED',
        note: body.reason,
      }],
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      entityType: 'CapacityChangeRequest',
    };
    try {
      await this.requests.createRequest({
        item,
        idempotency: { key, requestHash },
        expectedCommitmentQuantity: commitment.quantity,
        updatedAt: nowIso,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        if (error.failedTransactItemIndexes?.includes(CHANGE_CREATE_TX.IDEMPOTENCY)) {
          const raced = await this.requests.getIdempotency(vendorId, key);
          if (raced) return this.replay(raced, requestHash);
        }
        throw conflict(
          'COMMITMENT_CHANGED',
          'The commitment changed or already has a pending change request; reload and retry',
        );
      }
      throw error;
    }
    this.logger.info({
      event: 'capacity_change_requested',
      requestId,
      vendorId,
      commitmentId: commitment.commitmentId,
      currentQuantity: commitment.quantity,
      requestedQuantity: body.requestedQuantity,
    });
    return toChangeResponse(item);
  }

  async list(request: LambdaRequest): Promise<{ items: CapacityChangeRequestResponse[] }> {
    const vendorId = getVendorId(request);
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor not found');
    assertVendorManager(request, vendor);
    const items = await this.requests.listVendorRequests(vendorId);
    return { items: items.map(toChangeResponse) };
  }

  async opsList(request: LambdaRequest): Promise<{ items: CapacityChangeRequestResponse[] }> {
    assertAdminAccess(request);
    const raw = (request.params?.status ?? request.query?.status) as string | undefined;
    const statuses = raw ? [parseStatus(raw)] : [CAPACITY_CHANGE_STATUS.PENDING];
    const pages = await Promise.all(statuses.map((status) => this.requests.listByStatus(status, 100)));
    return { items: pages.flat().map(toChangeResponse) };
  }

  async approve(request: LambdaRequest): Promise<CapacityChangeRequestResponse> {
    const adminId = assertAdminAccess(request);
    getIdempotencyKey(request);
    const body = parseBody(ApproveCapacityChangeSchema, request.body);
    const change = await this.requireRequest(getPathParam(request, 'requestId'));
    if (change.status === CAPACITY_CHANGE_STATUS.APPROVED) return toChangeResponse(change);
    this.assertPending(change);

    // Ledger first, then commitments: a concurrent write fails the ledger/commitment conditions.
    const ledger = await this.capacity.getLedger(change.vendorId);
    const commitment = await this.capacity.getCommitment(change.vendorId, change.commitmentId) as ChangeAwareCommitment | null;
    if (!commitment) throw new NotFoundError('Capacity commitment not found');
    if (commitment.status !== CAPACITY_COMMITMENT_STATUS.CHANGE_PENDING
      || commitment.pendingChangeRequestId !== change.requestId) {
      throw conflict('COMMITMENT_STATE_MISMATCH', 'Commitment is not waiting on this change request');
    }

    // Never silently reduce: sold obligations are read from the commitment just now.
    const outcome = evaluateApproval({
      currentQuantity: commitment.quantity,
      requestedQuantity: change.requestedQuantity,
      reservedSoldQuantity: commitment.reservedSoldQuantity,
      decision: body.replacementCoverageDecision,
    });
    if (change.requestedQuantity > commitment.quantity) {
      await this.assertCanGrow(commitment, change.requestedQuantity);
    }

    const nowIso = this.now().toISOString();
    const noteText = body.note ?? body.replacementCoverageDecision?.note;
    const next: CapacityChangeRequestDdbItem = {
      ...change,
      GSI1SK: capacityChangeKeys.gsi1Sk(CAPACITY_CHANGE_STATUS.APPROVED, change.createdAt, change.requestId),
      status: CAPACITY_CHANGE_STATUS.APPROVED,
      ...(outcome.decision ? { replacementCoverageDecision: outcome.decision } : {}),
      soldQuantityAtDecision: commitment.reservedSoldQuantity,
      decidedBy: adminId,
      decidedAt: nowIso,
      ...(noteText ? { decisionNote: noteText } : {}),
      history: [...change.history, {
        at: nowIso,
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'APPROVED',
        ...(noteText ? { note: noteText } : {}),
      }],
      version: change.version + 1,
      updatedAt: nowIso,
    };
    try {
      await this.requests.approve({
        item: next,
        expectedVersion: change.version,
        expectedQuantity: commitment.quantity,
        expectedSoldQuantity: commitment.reservedSoldQuantity,
        newQuantity: outcome.newQuantity,
        newStatus: outcome.newStatus,
        salesBlocked: outcome.salesBlocked,
        expectedLedgerVersion: ledger?.version ?? 0,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Commitment or request changed during approval (sold quantity may have moved); re-check and retry');
      }
      throw error;
    }
    this.logger.info({
      event: 'capacity_change_approved',
      requestId: change.requestId,
      vendorId: change.vendorId,
      commitmentId: change.commitmentId,
      from: commitment.quantity,
      to: outcome.newQuantity,
      sold: commitment.reservedSoldQuantity,
      coverageDecision: outcome.decision?.decision,
      by: adminId,
    });
    return toChangeResponse(next);
  }

  async reject(request: LambdaRequest): Promise<CapacityChangeRequestResponse> {
    const adminId = assertAdminAccess(request);
    getIdempotencyKey(request);
    const body = parseBody(RejectCapacityChangeSchema, request.body);
    const change = await this.requireRequest(getPathParam(request, 'requestId'));
    if (change.status === CAPACITY_CHANGE_STATUS.REJECTED) return toChangeResponse(change);
    this.assertPending(change);

    const nowIso = this.now().toISOString();
    const next: CapacityChangeRequestDdbItem = {
      ...change,
      GSI1SK: capacityChangeKeys.gsi1Sk(CAPACITY_CHANGE_STATUS.REJECTED, change.createdAt, change.requestId),
      status: CAPACITY_CHANGE_STATUS.REJECTED,
      decidedBy: adminId,
      decidedAt: nowIso,
      decisionNote: body.reason,
      history: [...change.history, {
        at: nowIso,
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'REJECTED',
        note: body.reason,
      }],
      version: change.version + 1,
      updatedAt: nowIso,
    };
    try {
      await this.requests.reject({ item: next, expectedVersion: change.version });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Request or commitment changed concurrently; reload and retry');
      }
      throw error;
    }
    this.logger.info({
      event: 'capacity_change_rejected',
      requestId: change.requestId,
      vendorId: change.vendorId,
      commitmentId: change.commitmentId,
      by: adminId,
    });
    return toChangeResponse(next);
  }

  private async requireRequest(requestId: string): Promise<CapacityChangeRequestDdbItem> {
    const change = await this.requests.getRequestById(requestId);
    if (!change) throw new NotFoundError('Capacity change request not found');
    return change;
  }

  private assertPending(change: CapacityChangeRequestDdbItem): void {
    if (change.status !== CAPACITY_CHANGE_STATUS.PENDING) {
      throw conflict('CHANGE_ALREADY_DECIDED', `Request is already ${change.status}`);
    }
  }

  private async replay(
    existing: { requestHash: string; requestId: string; vendorId: string },
    requestHash: string,
  ): Promise<CapacityChangeRequestResponse> {
    if (existing.requestHash !== requestHash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    }
    const found = await this.requests.getRequest(existing.vendorId, existing.requestId);
    if (!found) throw new NotFoundError('Capacity change request not found');
    return toChangeResponse(found);
  }

  /** Growing a commitment must still fit the vendor's crew capacity, like a new commitment. */
  private async assertCanGrow(commitment: CapacityCommitmentDdbItem, requestedQuantity: number): Promise<void> {
    const [commitments, crews] = await Promise.all([
      this.capacity.listCommitments(commitment.vendorId),
      this.crews.listAllCrews(commitment.vendorId),
    ]);
    assertCapacityAvailable({
      commitments: commitments.filter((item) => item.commitmentId !== commitment.commitmentId),
      window: commitment.window,
      quantity: requestedQuantity,
      capacityPerDay: dailyCapacity(crews.filter((crew) => crew.status === 'ACTIVE').length),
    });
  }
}

function parseStatus(value: string): CapacityChangeStatus {
  if (value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED') return value;
  throw new ValidationError('status must be PENDING, APPROVED, or REJECTED');
}

let service: CapacityChangeRequestsService;

export function getCapacityChangeRequestsService(): CapacityChangeRequestsService {
  if (!service) service = new CapacityChangeRequestsService();
  return service;
}
