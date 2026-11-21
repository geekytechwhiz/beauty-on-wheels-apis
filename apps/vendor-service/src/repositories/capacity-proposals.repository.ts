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
  PlanSoldCapacityReservationDdbItem,
} from '../domain/capacity-commitment';
import {
  CapacityIdempotencyDdbItem,
  CapacityProposalDdbItem,
  CapacityProposalStatus,
} from '../domain/capacity-proposal';
import {
  CAPACITY_LEDGER_ENTITY_TYPE,
  CAPACITY_LOOKUP_ENTITY_TYPE,
  PLAN_SOLD_CAPACITY_RESERVATION_ENTITY_TYPE,
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
   * Atomically records a plan reservation pointer and increments `reservedSoldQuantity`.
   * Condition: commitment is capacity-holding and `reservedSoldQuantity + quantity <= quantity` cap
   * (i.e. remaining slot-units >= quantity). Fails the transaction when oversold.
   * Use kind=hold at checkout; kind=sold at payment confirmation (or legacy direct reserve).
   */
  async reserveSoldCapacity(input: {
    vendorId: string;
    commitmentId: string;
    /** Demand slot-units to reserve. */
    quantity: number;
    /**
     * Commitment `quantity` from the consistent read used for selection.
     * Dynamo ConditionExpressions cannot compute `quantity - :qty`; the
     * remaining-cap check is `reservedSoldQuantity <= commitmentQuantity - quantity`.
     */
    commitmentQuantity: number;
    idempotencyKey: string;
    planId: string;
    kind?: CapacityReservationKind;
    expiresAt?: string;
    paymentId?: string;
  }): Promise<void> {
    const {
      vendorId,
      commitmentId,
      quantity,
      commitmentQuantity,
      idempotencyKey,
      planId,
      kind = CAPACITY_RESERVATION_KIND.SOLD,
      expiresAt,
      paymentId,
    } = input;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    if (!Number.isInteger(commitmentQuantity) || commitmentQuantity < 1) {
      throw new Error('commitmentQuantity must be a positive integer');
    }
    if (commitmentQuantity < quantity) {
      throw new Error('commitmentQuantity must be >= demand quantity');
    }
    if (kind === CAPACITY_RESERVATION_KIND.HOLD && !expiresAt) {
      throw new Error('expiresAt is required for capacity holds');
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
        this.commitmentSoldQuantityDeltaUpdate({
          vendorId,
          commitmentId,
          delta: quantity,
          commitmentQuantity,
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

  /** Decrements sold quantity and removes the plan reservation pointer (refund/cancel/expired hold). */
  async releaseSoldCapacity(input: {
    vendorId: string;
    commitmentId: string;
    quantity: number;
    planId: string;
  }): Promise<void> {
    const { vendorId, commitmentId, quantity, planId } = input;
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
        this.commitmentSoldQuantityDeltaUpdate({
          vendorId,
          commitmentId,
          delta: -quantity,
          updatedAt: now,
        }),
      ] as never,
    });
  }

  // ---- helpers -----------------------------------------------------------

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
