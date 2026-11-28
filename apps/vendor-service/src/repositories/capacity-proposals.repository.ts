import { BaseRepository, ConditionalWriteConflictError } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

import { env } from '../configs/env.config';
import {
  CAPACITY_HOLDING_STATUSES,
  CAPACITY_RESERVATION_KIND,
  CapacityCommitmentDdbItem,
  CapacityCommitmentStatus,
  CapacityLedgerDdbItem,
  CapacityReservationKind,
  CommitmentDaySoldDdbItem,
  PlanSoldCapacityReservationDdbItem,
  VisitSoldCapacityReservationDdbItem,
} from '../domain/capacity-commitment';
import {
  CapacityIdempotencyDdbItem,
  CapacityProposalDdbItem,
  CapacityProposalStatus,
} from '../domain/capacity-proposal';
import {
  CAPACITY_LEDGER_ENTITY_TYPE,
  CAPACITY_LOOKUP_ENTITY_TYPE,
  COMMITMENT_DAY_SOLD_ENTITY_TYPE,
  PLAN_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE,
  VISIT_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';

interface LookupItem {
  PK: string;
  SK: string;
  vendorId: string;
  entityType: typeof CAPACITY_LOOKUP_ENTITY_TYPE;
}

export interface ProposalPageResult {
  items: CapacityProposalDdbItem[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListProposalsParams {
  vendorId?: string;
  communityId?: string;
  status?: CapacityProposalStatus;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface ListOpsCommitmentsParams {
  vendorId?: string;
  communityId?: string;
  status?: CapacityCommitmentStatus;
  fromDate?: string;
  toDate?: string;
  dailyWindowStart?: string;
  dailyWindowEnd?: string;
  limit?: number;
  lastEvaluatedKey?: Record<string, unknown>;
}

/**
 * Transaction item order is part of the contract with CapacityProposalsService, which maps a
 * failed condition index back to a conflict reason.
 */
export const CREATE_TX = { IDEMPOTENCY: 0, PROPOSAL: 1, LOOKUP: 2, COVERAGE: 3 } as const;
export const TRANSITION_TX = { IDEMPOTENCY: 0, PROPOSAL: 1, COVERAGE: 2 } as const;
export const ACCEPT_TX = {
  IDEMPOTENCY: 0,
  PROPOSAL: 1,
  LEDGER: 2,
  COMMITMENT: 3,
  COMMITMENT_LOOKUP: 4,
  COVERAGE: 5,
} as const;

export class CapacityProposalsRepository extends BaseRepository {
  public getTableName() {
    return env.DYNAMODB_TABLE_NAME;
  }

  // ---- reads -------------------------------------------------------------

  async getIdempotency(scopeHash: string): Promise<CapacityIdempotencyDdbItem | null> {
    return this.get<CapacityIdempotencyDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.capacityIdempotencyPk(scopeHash),
        SK: VendorKeyBuilder.capacityIdempotencySk(),
      },
      { consistent: true },
    );
  }

  async getProposal(
    vendorId: string,
    proposalId: string,
  ): Promise<CapacityProposalDdbItem | null> {
    return this.get<CapacityProposalDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.vendorPk(vendorId),
        SK: VendorKeyBuilder.capacityProposalSk(proposalId),
      },
      { consistent: true },
    );
  }

  /** Resolves a proposal by id alone through its lookup row. */
  async getProposalById(proposalId: string): Promise<CapacityProposalDdbItem | null> {
    const lookup = await this.get<LookupItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.capacityProposalLookupPk(proposalId),
        SK: VendorKeyBuilder.capacityLookupSk(),
      },
      { consistent: true },
    );
    return lookup ? this.getProposal(lookup.vendorId, proposalId) : null;
  }

  async listProposals(params: ListProposalsParams): Promise<ProposalPageResult> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const filters: string[] = [];
    let query: QueryCommandInput;

    if (params.vendorId) {
      query = {
        TableName: this.getTableName(),
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      };
      values[':pk'] = VendorKeyBuilder.vendorPk(params.vendorId);
      values[':sk'] = VendorKeyBuilder.capacityProposalSkPrefix();
      if (params.communityId) {
        names['#communityId'] = 'communityId';
        values[':communityId'] = params.communityId;
        filters.push('#communityId = :communityId');
      }
      if (params.status) {
        names['#status'] = 'status';
        values[':status'] = params.status;
        filters.push('#status = :status');
      }
    } else if (params.communityId) {
      query = {
        TableName: this.getTableName(),
        IndexName: 'GSI3',
        KeyConditionExpression: 'GSI3PK = :pk AND begins_with(GSI3SK, :sk)',
        ScanIndexForward: false,
      };
      values[':pk'] = VendorKeyBuilder.capacityProposalGsi3Pk(params.communityId);
      values[':sk'] = 'PROPOSAL#';
      if (params.status) {
        names['#status'] = 'status';
        values[':status'] = params.status;
        filters.push('#status = :status');
      }
    } else {
      query = {
        TableName: this.getTableName(),
        IndexName: 'GSI1',
        ScanIndexForward: false,
      };
      values[':pk'] = VendorKeyBuilder.capacityProposalGsi1Pk();
      if (params.status) {
        query.KeyConditionExpression = 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)';
        values[':sk'] = VendorKeyBuilder.capacityProposalGsi1StatusPrefix(params.status);
      } else {
        query.KeyConditionExpression = 'GSI1PK = :pk';
      }
    }

    query.ExpressionAttributeValues = values;
    if (Object.keys(names).length > 0) {
      query.ExpressionAttributeNames = names;
    }
    if (filters.length > 0) {
      query.FilterExpression = filters.join(' AND ');
    }
    if (params.limit) {
      query.Limit = params.limit;
    }
    if (params.lastEvaluatedKey) {
      query.ExclusiveStartKey = params.lastEvaluatedKey;
    }
    return this.queryPage<CapacityProposalDdbItem>(query);
  }

  /**
   * Admin committed-supply page.
   * A vendorId reads that vendor's base-table rows, including commitments written
   * before the operations index. Without a vendorId the read uses GSI1/GSI3 and
   * omits rows that were never written with those keys.
   */
  async listOpsCommitments(params: ListOpsCommitmentsParams): Promise<{
    items: CapacityCommitmentDdbItem[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const filters: string[] = [];
    const query: QueryCommandInput = { TableName: this.getTableName() };

    if (params.vendorId) {
      query.KeyConditionExpression = 'PK = :pk AND begins_with(SK, :sk)';
      query.ConsistentRead = true;
      values[':pk'] = VendorKeyBuilder.vendorPk(params.vendorId);
      values[':sk'] = VendorKeyBuilder.capacityCommitmentSkPrefix();
      if (params.status) {
        names['#status'] = 'status';
        values[':status'] = params.status;
        filters.push('#status = :status');
      }
      if (params.communityId) {
        names['#communityId'] = 'communityId';
        values[':communityId'] = params.communityId;
        filters.push('#communityId = :communityId');
      }
    } else if (params.communityId) {
      query.IndexName = 'GSI3';
      query.ScanIndexForward = false;
      values[':pk'] = VendorKeyBuilder.capacityCommitmentGsi3Pk(params.communityId);
      values[':sk'] = VendorKeyBuilder.capacityCommitmentGsi3Prefix(params.status);
      query.KeyConditionExpression = 'GSI3PK = :pk AND begins_with(GSI3SK, :sk)';
    } else {
      query.IndexName = 'GSI1';
      query.ScanIndexForward = false;
      values[':pk'] = VendorKeyBuilder.capacityCommitmentGsi1Pk();
      if (params.status) {
        query.KeyConditionExpression = 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)';
        values[':sk'] = VendorKeyBuilder.capacityCommitmentGsi1StatusPrefix(params.status);
      } else {
        query.KeyConditionExpression = 'GSI1PK = :pk';
      }
    }

    if (params.fromDate && params.toDate) {
      names['#window'] = 'window';
      names['#startDate'] = 'startDate';
      names['#endDate'] = 'endDate';
      values[':fromDate'] = params.fromDate;
      values[':toDate'] = params.toDate;
      filters.push('#window.#startDate <= :toDate AND #window.#endDate >= :fromDate');
    }
    if (params.dailyWindowStart) {
      names['#window'] = 'window';
      names['#dailyWindow'] = 'dailyWindow';
      names['#startTime'] = 'startTime';
      values[':dailyWindowStart'] = params.dailyWindowStart;
      filters.push('#window.#dailyWindow.#startTime = :dailyWindowStart');
    }
    if (params.dailyWindowEnd) {
      names['#window'] = 'window';
      names['#dailyWindow'] = 'dailyWindow';
      names['#endTime'] = 'endTime';
      values[':dailyWindowEnd'] = params.dailyWindowEnd;
      filters.push('#window.#dailyWindow.#endTime = :dailyWindowEnd');
    }

    query.ExpressionAttributeValues = values;
    if (Object.keys(names).length > 0) query.ExpressionAttributeNames = names;
    if (filters.length > 0) query.FilterExpression = filters.join(' AND ');
    if (params.limit) query.Limit = params.limit;
    if (params.lastEvaluatedKey) query.ExclusiveStartKey = params.lastEvaluatedKey;
    return this.queryPage<CapacityCommitmentDdbItem>(query);
  }

  async getLedger(vendorId: string): Promise<CapacityLedgerDdbItem | null> {
    return this.get<CapacityLedgerDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.vendorPk(vendorId),
        SK: VendorKeyBuilder.capacityLedgerSk(),
      },
      { consistent: true },
    );
  }

  /** Strongly consistent. Read the ledger first, then this, so a concurrent accept fails the ledger check. */
  async listCommitments(vendorId: string): Promise<CapacityCommitmentDdbItem[]> {
    return this.queryAll<CapacityCommitmentDdbItem>({
      TableName: this.getTableName(),
      ConsistentRead: true,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': VendorKeyBuilder.vendorPk(vendorId),
        ':sk': VendorKeyBuilder.capacityCommitmentSkPrefix(),
      },
    });
  }

  async getCommitment(
    vendorId: string,
    commitmentId: string,
  ): Promise<CapacityCommitmentDdbItem | null> {
    return this.get<CapacityCommitmentDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.vendorPk(vendorId),
        SK: VendorKeyBuilder.capacityCommitmentSk(commitmentId),
      },
      { consistent: true },
    );
  }

  async getCommitmentById(commitmentId: string): Promise<CapacityCommitmentDdbItem | null> {
    const lookup = await this.get<LookupItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.capacityCommitmentLookupPk(commitmentId),
        SK: VendorKeyBuilder.capacityLookupSk(),
      },
      { consistent: true },
    );
    return lookup ? this.getCommitment(lookup.vendorId, commitmentId) : null;
  }

  async getSoldCapacityReservation(
    planId: string,
  ): Promise<PlanSoldCapacityReservationDdbItem | null> {
    return this.get<PlanSoldCapacityReservationDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.planSoldCapacityReservationPk(planId),
        SK: VendorKeyBuilder.planSoldCapacityReservationSk(),
      },
      { consistent: true },
    );
  }

  async getVisitSoldCapacityReservation(
    visitId: string,
  ): Promise<VisitSoldCapacityReservationDdbItem | null> {
    return this.get<VisitSoldCapacityReservationDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.visitSoldCapacityReservationPk(visitId),
        SK: VendorKeyBuilder.visitSoldCapacityReservationSk(),
      },
      { consistent: true },
    );
  }

  async getCommitmentDaySold(
    vendorId: string,
    commitmentId: string,
    date: string,
  ): Promise<CommitmentDaySoldDdbItem | null> {
    return this.get<CommitmentDaySoldDdbItem>(
      this.getTableName(),
      {
        PK: VendorKeyBuilder.vendorPk(vendorId),
        SK: VendorKeyBuilder.commitmentDaySoldSk(commitmentId, date),
      },
      { consistent: true },
    );
  }

  // ---- writes ------------------------------------------------------------

  /** Idempotency record + proposal + id lookup, only while coverage is still APPROVED. */
  async createProposal(input: {
    item: CapacityProposalDdbItem;
    idempotency: CapacityIdempotencyDdbItem;
  }): Promise<void> {
    const { item } = input;
    await this.transactWrite({
      TransactItems: [
        this.idempotencyPut(input.idempotency),
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.lookupItem(
              VendorKeyBuilder.capacityProposalLookupPk(item.proposalId),
              item.vendorId,
            ),
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        this.coverageApprovedCheck(item.vendorId, item.communityId),
      ],
    });
  }

  /**
   * Replaces a proposal, conditional on the version that was read. `item.version` must be
   * `expectedVersion + 1`. Never touches commitments.
   */
  async transitionProposal(input: {
    item: CapacityProposalDdbItem;
    expectedVersion: number;
    idempotency?: CapacityIdempotencyDdbItem;
    requireApprovedCoverage?: boolean;
  }): Promise<void> {
    // With an idempotency record the order is TRANSITION_TX. Without one (system expiry)
    // the proposal put is first. A transaction cannot touch one item twice, so there is no
    // separate version check.
    const items: Array<Record<string, unknown>> = [];
    if (input.idempotency) {
      items.push(this.idempotencyPut(input.idempotency));
    }
    items.push({ Put: this.proposalVersionPut(input.item, input.expectedVersion) });
    if (input.requireApprovedCoverage) {
      items.push(this.coverageApprovedCheck(input.item.vendorId, input.item.communityId));
    }
    await this.transactWrite({ TransactItems: items as never });
  }

  /**
   * Final accept. One transaction writes the ACCEPTED proposal, the commitment (with its id
   * lookup), bumps the vendor ledger, and stores the idempotency record. The ledger put is
   * conditional on the version read before the capacity check, so two accepts that were
   * computed against the same commitments cannot both succeed.
   */
  async acceptProposal(input: {
    item: CapacityProposalDdbItem;
    expectedVersion: number;
    commitment: CapacityCommitmentDdbItem;
    expectedLedgerVersion: number;
    idempotency: CapacityIdempotencyDdbItem;
  }): Promise<void> {
    const { item, commitment } = input;
    const now = commitment.createdAt;
    const ledger: CapacityLedgerDdbItem = {
      PK: VendorKeyBuilder.vendorPk(item.vendorId),
      SK: VendorKeyBuilder.capacityLedgerSk(),
      vendorId: item.vendorId,
      version: input.expectedLedgerVersion + 1,
      updatedAt: now,
      entityType: CAPACITY_LEDGER_ENTITY_TYPE,
    };
    const ledgerPut: Record<string, unknown> = {
      TableName: this.getTableName(),
      Item: ledger,
    };
    if (input.expectedLedgerVersion === 0) {
      ledgerPut.ConditionExpression = 'attribute_not_exists(PK)';
    } else {
      ledgerPut.ConditionExpression = '#version = :expectedLedgerVersion';
      ledgerPut.ExpressionAttributeNames = { '#version': 'version' };
      ledgerPut.ExpressionAttributeValues = {
        ':expectedLedgerVersion': input.expectedLedgerVersion,
      };
    }

    await this.transactWrite({
      TransactItems: [
        this.idempotencyPut(input.idempotency),
        { Put: this.proposalVersionPut(item, input.expectedVersion) },
        { Put: ledgerPut },
        {
          Put: {
            TableName: this.getTableName(),
            Item: commitment,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Put: {
            TableName: this.getTableName(),
            Item: this.lookupItem(
              VendorKeyBuilder.capacityCommitmentLookupPk(commitment.commitmentId),
              commitment.vendorId,
            ),
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        this.coverageApprovedCheck(item.vendorId, item.communityId),
      ] as never,
    });
  }

  /**
   * Atomically records a plan reservation pointer and claims period (or legacy daily) capacity.
   *
   * Default `consumesDailySlots: false` claims `claimedPeriodQuantity` against
   * `periodSupply` (= daily quantity × service days). Legacy callers may pass
   * `consumesDailySlots: true` to debit `reservedSoldQuantity` against daily `quantity`.
   */
  async reserveSoldCapacity(input: {
    vendorId: string;
    commitmentId: string;
    /** Plan period demand (lifetime visit-slot units) stored on the pointer. */
    quantity: number;
    /**
     * When consumesDailySlots=true: commitment daily `quantity`.
     * When false (default): unused for the cap (periodSupply is required instead).
     */
    commitmentQuantity: number;
    /** Required when consumesDailySlots=false. periodSupply = quantity * serviceDays. */
    periodSupply?: number;
    idempotencyKey: string;
    planId: string;
    kind?: CapacityReservationKind;
    /** false (default) = period eligibility; true = legacy daily-pool debit. */
    consumesDailySlots?: boolean;
    expiresAt?: string;
    paymentId?: string;
  }): Promise<void> {
    const {
      vendorId,
      commitmentId,
      quantity,
      commitmentQuantity,
      periodSupply,
      idempotencyKey,
      planId,
      kind = CAPACITY_RESERVATION_KIND.SOLD,
      consumesDailySlots = false,
      expiresAt,
      paymentId,
    } = input;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    if (!Number.isInteger(commitmentQuantity) || commitmentQuantity < 1) {
      throw new Error('commitmentQuantity must be a positive integer');
    }
    if (kind === CAPACITY_RESERVATION_KIND.HOLD && !expiresAt) {
      throw new Error('expiresAt is required for capacity holds');
    }
    if (!consumesDailySlots) {
      if (!Number.isInteger(periodSupply) || (periodSupply as number) < 1) {
        throw new Error('periodSupply must be a positive integer for period eligibility');
      }
      if ((periodSupply as number) < quantity) {
        throw new Error('periodSupply must be >= demand quantity');
      }
    } else if (commitmentQuantity < quantity) {
      throw new Error('commitmentQuantity must be >= demand quantity');
    }
    const now = new Date().toISOString();
    const reservation: PlanSoldCapacityReservationDdbItem = {
      PK: VendorKeyBuilder.planSoldCapacityReservationPk(planId),
      SK: VendorKeyBuilder.planSoldCapacityReservationSk(),
      planId,
      vendorId,
      commitmentId,
      quantity,
      idempotencyKey,
      kind,
      consumesDailySlots,
      createdAt: now,
      updatedAt: now,
      entityType: PLAN_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE,
      ...(expiresAt ? { expiresAt } : {}),
      ...(paymentId ? { paymentId } : {}),
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: reservation,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        consumesDailySlots
          ? this.commitmentSoldQuantityDeltaUpdate({
            vendorId,
            commitmentId,
            delta: quantity,
            commitmentQuantity,
            updatedAt: now,
          })
          : this.commitmentPeriodClaimDeltaUpdate({
            vendorId,
            commitmentId,
            delta: quantity,
            periodSupply: periodSupply as number,
            updatedAt: now,
          }),
      ] as never,
    });
  }

  /**
   * Converts an unexpired hold into a durable sold reservation without changing quantity.
   * Throws ConditionalWriteConflictError when missing, expired, or already converted under race.
   */
  async confirmCapacityHold(input: {
    planId: string;
    expectedCommitmentId: string;
    expectedQuantity: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.update({
        TableName: this.getTableName(),
        Key: {
          PK: VendorKeyBuilder.planSoldCapacityReservationPk(input.planId),
          SK: VendorKeyBuilder.planSoldCapacityReservationSk(),
        },
        UpdateExpression: 'SET kind = :sold, updatedAt = :now REMOVE expiresAt',
        ConditionExpression:
          'attribute_exists(PK)'
          + ' AND commitmentId = :commitmentId'
          + ' AND #qty = :qty'
          + ' AND (attribute_not_exists(kind) OR kind = :hold)'
          + ' AND (attribute_not_exists(expiresAt) OR expiresAt > :now)',
        ExpressionAttributeNames: { '#qty': 'quantity' },
        ExpressionAttributeValues: {
          ':sold': CAPACITY_RESERVATION_KIND.SOLD,
          ':hold': CAPACITY_RESERVATION_KIND.HOLD,
          ':commitmentId': input.expectedCommitmentId,
          ':qty': input.expectedQuantity,
          ':now': now,
        },
      });
    } catch (error: unknown) {
      const name = error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: string }).name)
        : '';
      if (name === 'ConditionalCheckFailedException' || error instanceof ConditionalWriteConflictError) {
        throw error instanceof ConditionalWriteConflictError
          ? error
          : new ConditionalWriteConflictError(error as Error);
      }
      throw error;
    }
  }

  /** Releases a plan pointer and undoes its period claim or legacy daily debit. */
  async releaseSoldCapacity(input: {
    vendorId: string;
    commitmentId: string;
    quantity: number;
    planId: string;
    /** false = release period claim; true/omitted for legacy = release reservedSoldQuantity. */
    consumesDailySlots?: boolean;
  }): Promise<void> {
    const {
      vendorId,
      commitmentId,
      quantity,
      planId,
      consumesDailySlots = true,
    } = input;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    const now = new Date().toISOString();
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.planSoldCapacityReservationPk(planId),
              SK: VendorKeyBuilder.planSoldCapacityReservationSk(),
            },
            ConditionExpression: 'attribute_exists(PK) AND commitmentId = :commitmentId AND #qty = :qty',
            ExpressionAttributeNames: { '#qty': 'quantity' },
            ExpressionAttributeValues: {
              ':commitmentId': commitmentId,
              ':qty': quantity,
            },
          },
        },
        consumesDailySlots
          ? this.commitmentSoldQuantityDeltaUpdate({
            vendorId,
            commitmentId,
            delta: -quantity,
            updatedAt: now,
          })
          : this.commitmentPeriodClaimDeltaUpdate({
            vendorId,
            commitmentId,
            delta: -quantity,
            updatedAt: now,
          }),
      ] as never,
    });
  }

  /**
   * Reserves visit slot-units against a commitment service day.
   * Caps the day ledger by the commitment's per-day `quantity`.
   */
  async reserveVisitSoldCapacity(input: {
    vendorId: string;
    commitmentId: string;
    commitmentQuantity: number;
    planId: string;
    visitId: string;
    date: string;
    quantity: number;
    startTime?: string;
    endTime?: string;
  }): Promise<void> {
    const {
      vendorId,
      commitmentId,
      commitmentQuantity,
      planId,
      visitId,
      date,
      quantity,
      startTime,
      endTime,
    } = input;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    if (!Number.isInteger(commitmentQuantity) || commitmentQuantity < 1) {
      throw new Error('commitmentQuantity must be a positive integer');
    }
    if (commitmentQuantity < quantity) {
      throw new Error('commitmentQuantity must be >= visit demand');
    }
    const now = new Date().toISOString();
    const reservation: VisitSoldCapacityReservationDdbItem = {
      PK: VendorKeyBuilder.visitSoldCapacityReservationPk(visitId),
      SK: VendorKeyBuilder.visitSoldCapacityReservationSk(),
      visitId,
      planId,
      vendorId,
      commitmentId,
      date,
      quantity,
      createdAt: now,
      updatedAt: now,
      entityType: VISIT_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
    };
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: reservation,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        this.commitmentDaySoldDeltaUpdate({
          vendorId,
          commitmentId,
          date,
          delta: quantity,
          commitmentQuantity,
          updatedAt: now,
        }),
      ] as never,
    });
  }

  async releaseVisitSoldCapacity(input: {
    vendorId: string;
    commitmentId: string;
    visitId: string;
    date: string;
    quantity: number;
  }): Promise<void> {
    const { vendorId, commitmentId, visitId, date, quantity } = input;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    const now = new Date().toISOString();
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: VendorKeyBuilder.visitSoldCapacityReservationPk(visitId),
              SK: VendorKeyBuilder.visitSoldCapacityReservationSk(),
            },
            ConditionExpression:
              'attribute_exists(PK) AND commitmentId = :commitmentId AND #date = :date AND #qty = :qty',
            ExpressionAttributeNames: { '#qty': 'quantity', '#date': 'date' },
            ExpressionAttributeValues: {
              ':commitmentId': commitmentId,
              ':date': date,
              ':qty': quantity,
            },
          },
        },
        this.commitmentDaySoldDeltaUpdate({
          vendorId,
          commitmentId,
          date,
          delta: -quantity,
          updatedAt: now,
        }),
      ] as never,
    });
  }

  // ---- helpers -----------------------------------------------------------

  private commitmentPeriodClaimDeltaUpdate(input: {
    vendorId: string;
    commitmentId: string;
    delta: number;
    updatedAt: string;
    /** Required on increment — quantity * serviceDays from selection. */
    periodSupply?: number;
  }): Record<string, unknown> {
    const absDelta = Math.abs(input.delta);
    const isIncrement = input.delta > 0;
    const statusPlaceholders = CAPACITY_HOLDING_STATUSES.map(
      (_, index) => `:holdingStatus${index}`,
    ).join(', ');
    const statusValues = Object.fromEntries(
      CAPACITY_HOLDING_STATUSES.map((status, index) => [`:holdingStatus${index}`, status]),
    );
    // ConditionExpression cannot use if_not_exists (UpdateExpression SET only).
    // Treat a missing claimedPeriodQuantity as 0 via attribute_not_exists + :zero <= :maxClaimed.
    const conditionExpression = isIncrement
      ? `#status IN (${statusPlaceholders})`
        + ' AND :zero <= :maxClaimed'
        + ' AND (attribute_not_exists(claimedPeriodQuantity) OR claimedPeriodQuantity <= :maxClaimed)'
      : `#status IN (${statusPlaceholders})`
        + ' AND attribute_exists(claimedPeriodQuantity) AND claimedPeriodQuantity >= :qty';
    const incrementValues = isIncrement
      ? {
        ':maxClaimed': (input.periodSupply as number) - absDelta,
        ':zero': 0,
      }
      : { ':qty': absDelta, ':zero': 0 };
    return {
      Update: {
        TableName: this.getTableName(),
        Key: {
          PK: VendorKeyBuilder.vendorPk(input.vendorId),
          SK: VendorKeyBuilder.capacityCommitmentSk(input.commitmentId),
        },
        UpdateExpression:
          'SET claimedPeriodQuantity = if_not_exists(claimedPeriodQuantity, :zero) + :delta,'
          + ' updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':delta': input.delta,
          ':updatedAt': input.updatedAt,
          ...incrementValues,
          ...statusValues,
        },
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: { '#status': 'status' },
      },
    };
  }

  private commitmentDaySoldDeltaUpdate(input: {
    vendorId: string;
    commitmentId: string;
    date: string;
    delta: number;
    updatedAt: string;
    /** Required on increment — commitment per-day quantity. */
    commitmentQuantity?: number;
  }): Record<string, unknown> {
    const absDelta = Math.abs(input.delta);
    const isIncrement = input.delta > 0;
    const key = {
      PK: VendorKeyBuilder.vendorPk(input.vendorId),
      SK: VendorKeyBuilder.commitmentDaySoldSk(input.commitmentId, input.date),
    };
    if (isIncrement) {
      return {
        Update: {
          TableName: this.getTableName(),
          Key: key,
          UpdateExpression:
            'SET vendorId = if_not_exists(vendorId, :vendorId),'
            + ' commitmentId = if_not_exists(commitmentId, :commitmentId),'
            + ' #date = if_not_exists(#date, :date),'
            + ' entityType = if_not_exists(entityType, :entityType),'
            + ' updatedAt = :updatedAt'
            + ' ADD reservedSoldQuantity :qty',
          ConditionExpression:
            'attribute_not_exists(reservedSoldQuantity)'
            + ' OR reservedSoldQuantity <= :maxReserved',
          ExpressionAttributeNames: { '#date': 'date' },
          ExpressionAttributeValues: {
            ':vendorId': input.vendorId,
            ':commitmentId': input.commitmentId,
            ':date': input.date,
            ':entityType': COMMITMENT_DAY_SOLD_ENTITY_TYPE,
            ':updatedAt': input.updatedAt,
            ':qty': absDelta,
            ':maxReserved': (input.commitmentQuantity as number) - absDelta,
          },
        },
      };
    }
    return {
      Update: {
        TableName: this.getTableName(),
        Key: key,
        UpdateExpression:
          'SET updatedAt = :updatedAt ADD reservedSoldQuantity :delta',
        ConditionExpression: 'attribute_exists(PK) AND reservedSoldQuantity >= :qty',
        ExpressionAttributeValues: {
          ':updatedAt': input.updatedAt,
          ':delta': -absDelta,
          ':qty': absDelta,
        },
      },
    };
  }

  private commitmentSoldQuantityDeltaUpdate(input: {
    vendorId: string;
    commitmentId: string;
    delta: number;
    updatedAt: string;
    /** Required on increment — commitment.quantity from the selection read. */
    commitmentQuantity?: number;
  }): Record<string, unknown> {
    const absDelta = Math.abs(input.delta);
    const isIncrement = input.delta > 0;
    const statusPlaceholders = CAPACITY_HOLDING_STATUSES.map(
      (_, index) => `:holdingStatus${index}`,
    ).join(', ');
    const statusValues = Object.fromEntries(
      CAPACITY_HOLDING_STATUSES.map((status, index) => [`:holdingStatus${index}`, status]),
    );
    /**
     * DynamoDB ConditionExpressions do not support attribute arithmetic
     * (`quantity - :qty` is a ValidationException). Bound remaining capacity with a
     * precomputed `:maxReserved` (= commitmentQuantity - demand) and pin `#quantity`
     * so a concurrent reduction cannot silently oversell.
     */
    const conditionExpression = isIncrement
      ? `#status IN (${statusPlaceholders})`
        + ' AND #quantity = :commitmentQuantity'
        + ' AND reservedSoldQuantity <= :maxReserved'
      : `#status IN (${statusPlaceholders}) AND reservedSoldQuantity >= :qty`;
    const incrementValues = isIncrement
      ? {
        ':commitmentQuantity': input.commitmentQuantity as number,
        ':maxReserved': (input.commitmentQuantity as number) - absDelta,
      }
      : { ':qty': absDelta };
    return {
      Update: {
        TableName: this.getTableName(),
        Key: {
          PK: VendorKeyBuilder.vendorPk(input.vendorId),
          SK: VendorKeyBuilder.capacityCommitmentSk(input.commitmentId),
        },
        UpdateExpression:
          'SET reservedSoldQuantity = reservedSoldQuantity + :delta, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':delta': input.delta,
          ':updatedAt': input.updatedAt,
          ...incrementValues,
          ...statusValues,
        },
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: isIncrement
          ? { '#status': 'status', '#quantity': 'quantity' }
          : { '#status': 'status' },
      },
    };
  }

  private lookupItem(pk: string, vendorId: string): LookupItem {
    return {
      PK: pk,
      SK: VendorKeyBuilder.capacityLookupSk(),
      vendorId,
      entityType: CAPACITY_LOOKUP_ENTITY_TYPE,
    };
  }

  private idempotencyPut(record: CapacityIdempotencyDdbItem): Record<string, unknown> {
    return {
      Put: {
        TableName: this.getTableName(),
        Item: record,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      },
    };
  }

  private proposalVersionPut(
    item: CapacityProposalDdbItem,
    expectedVersion: number,
  ): Record<string, unknown> {
    return {
      TableName: this.getTableName(),
      Item: item,
      ConditionExpression: 'attribute_exists(PK) AND #version = :expectedVersion',
      ExpressionAttributeNames: { '#version': 'version' },
      ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
    };
  }

  /** Fails the transaction if coverage was suspended or withdrawn after it was read. */
  private coverageApprovedCheck(vendorId: string, communityId: string): Record<string, unknown> {
    return {
      ConditionCheck: {
        TableName: this.getTableName(),
        Key: {
          PK: VendorKeyBuilder.vendorPk(vendorId),
          SK: VendorKeyBuilder.communitySk(communityId),
        },
        ConditionExpression: 'attribute_exists(PK) AND #approvalStatus = :approved',
        ExpressionAttributeNames: { '#approvalStatus': 'approvalStatus' },
        ExpressionAttributeValues: { ':approved': 'APPROVED' },
      },
    };
  }
}

let repository: CapacityProposalsRepository;

export function getCapacityProposalsRepository() {
  if (!repository) {
    repository = new CapacityProposalsRepository();
  }
  return repository;
}
