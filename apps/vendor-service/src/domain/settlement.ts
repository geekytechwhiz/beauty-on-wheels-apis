import { BaseError } from '@api-hub/utils';

export const STATEMENT_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  PAID: 'PAID',
  HELD: 'HELD',
  DISPUTED: 'DISPUTED',
  REJECTED: 'REJECTED',
} as const;

export type StatementStatus = (typeof STATEMENT_STATUS)[keyof typeof STATEMENT_STATUS];

export const LEDGER_SOURCE = { COMPLETED_VISIT: 'COMPLETED_VISIT', ADJUSTMENT: 'ADJUSTMENT' } as const;
export type LedgerSource = (typeof LEDGER_SOURCE)[keyof typeof LEDGER_SOURCE];

/** One TransactWrite holds 100 items: statement + lookup + idempotency + 2 per entry. */
export const MAX_STATEMENT_ENTRIES = 40;

export interface LedgerEntry {
  entryId: string;
  vendorId: string;
  visitId?: string;
  amountMinor: number;
  currency: 'INR';
  source: LedgerSource;
  status: 'PENDING_REVIEW';
  note?: string;
  createdAt: string;
}

export type StatementAction = 'APPROVE' | 'HOLD' | 'DISPUTE' | 'REJECT' | 'MARK_PAID';

export interface StatementHistoryEntry {
  at: string;
  by: string;
  action: StatementAction | 'GENERATED';
  fromStatus?: StatementStatus;
  toStatus: StatementStatus;
  reason?: string;
  transferReference?: string;
  paidAt?: string;
}

export interface SettlementStatementDdbItem {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  statementId: string;
  vendorId: string;
  periodStart: string;
  periodEnd: string;
  status: StatementStatus;
  entries: LedgerEntry[];
  totalMinor: number;
  currency: 'INR';
  /** Set only by mark-paid. Never inferred or defaulted. */
  transferReference?: string;
  paidAt?: string;
  paidBy?: string;
  history: StatementHistoryEntry[];
  generatedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  entityType: 'SettlementStatement';
}

export interface PayoutAccountView {
  accountHolderName: string;
  bankName: string;
  ifscCode: string;
  accountNumberMasked: string;
  accountNumberLast4: string;
}

export type SettlementStatementResponse =
  Omit<SettlementStatementDdbItem, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK' | 'entityType' | 'version'> & {
    /** Masked like GET bank-details. The full account number is never returned. */
    payoutAccount: PayoutAccountView | null;
  };

export const settlementKeys = {
  pk: (vendorId: string) => `VENDOR#${vendorId}`,
  statementSk: (statementId: string) => `SETTLEMENT_STATEMENT#${statementId}`,
  statementSkPrefix: () => 'SETTLEMENT_STATEMENT#',
  entrySk: (entryId: string) => `LEDGER_ENTRY#${entryId}`,
  lookupPk: (statementId: string) => `SETTLEMENT_STATEMENT#${statementId}`,
  lookupSk: () => 'LOOKUP',
  visitLockPk: (visitId: string) => `SETTLEMENT_VISIT#${visitId}`,
  visitLockSk: () => 'LOCK',
  gsi1Pk: () => 'SETTLEMENT_STATEMENT',
  gsi1Sk: (status: string, createdAt: string, statementId: string) => `STATUS#${status}#${createdAt}#${statementId}`,
  idempotencyPk: (vendorId: string, key: string) => `IDEMPOTENCY#SETTLEMENT#${vendorId}#${key}`,
  idempotencySk: () => 'RECORD',
};

export function toStatementResponse(
  item: SettlementStatementDdbItem,
  payoutAccount: PayoutAccountView | null,
): SettlementStatementResponse {
  const {
    PK: _pk, SK: _sk, GSI1PK: _g1pk, GSI1SK: _g1sk, entityType: _type, version: _version,
    ...response
  } = item;
  return { ...response, payoutAccount };
}

export function totalOf(entries: readonly Pick<LedgerEntry, 'amountMinor'>[]): number {
  return entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
}

function invalid(code: string, message: string, status = 409): BaseError {
  return new BaseError(message, status, code, undefined, { retryable: false });
}

const ALLOWED_FROM: Record<Exclude<StatementAction, 'MARK_PAID'>, readonly StatementStatus[]> = {
  APPROVE: [STATEMENT_STATUS.PENDING_REVIEW, STATEMENT_STATUS.HELD, STATEMENT_STATUS.DISPUTED],
  HOLD: [STATEMENT_STATUS.PENDING_REVIEW, STATEMENT_STATUS.APPROVED, STATEMENT_STATUS.DISPUTED],
  DISPUTE: [STATEMENT_STATUS.PENDING_REVIEW, STATEMENT_STATUS.APPROVED, STATEMENT_STATUS.HELD],
  REJECT: [
    STATEMENT_STATUS.PENDING_REVIEW,
    STATEMENT_STATUS.APPROVED,
    STATEMENT_STATUS.HELD,
    STATEMENT_STATUS.DISPUTED,
  ],
};

const TARGET: Record<Exclude<StatementAction, 'MARK_PAID'>, StatementStatus> = {
  APPROVE: STATEMENT_STATUS.APPROVED,
  HOLD: STATEMENT_STATUS.HELD,
  DISPUTE: STATEMENT_STATUS.DISPUTED,
  REJECT: STATEMENT_STATUS.REJECTED,
};

export interface StatementActionInput {
  reason?: string;
  transferReference?: string;
  paidAt?: string;
}

export interface StatementTransition {
  statement: SettlementStatementDdbItem;
  idempotent: boolean;
  /** Rejection frees the visits so they can be put on a later statement. */
  releaseVisitLocks: boolean;
}

/**
 * Every transition appends a history entry. PAID is reachable only through MARK_PAID from
 * APPROVED, with a transfer reference and a paidAt that is not in the future; no other
 * action can mark a statement paid, and nothing defaults those fields.
 */
export function applyStatementAction(
  statement: SettlementStatementDdbItem,
  action: StatementAction,
  input: StatementActionInput,
  actorId: string,
  now: Date,
): StatementTransition {
  const nowIso = now.toISOString();
  const bumped = (
    patch: Partial<SettlementStatementDdbItem>,
    toStatus: StatementStatus,
    entry: Omit<StatementHistoryEntry, 'at' | 'by' | 'fromStatus' | 'toStatus'>,
  ): SettlementStatementDdbItem => ({
    ...statement,
    ...patch,
    status: toStatus,
    GSI1SK: settlementKeys.gsi1Sk(toStatus, statement.createdAt, statement.statementId),
    history: [...statement.history, {
      at: nowIso,
      by: actorId,
      fromStatus: statement.status,
      toStatus,
      ...entry,
    }],
    version: statement.version + 1,
    updatedAt: nowIso,
  });

  if (action === 'MARK_PAID') {
    const reference = input.transferReference?.trim();
    if (!reference) throw invalid('TRANSFER_REFERENCE_REQUIRED', 'transferReference is required', 400);
    const paidAtMs = Date.parse(input.paidAt ?? '');
    if (Number.isNaN(paidAtMs)) throw invalid('PAID_AT_INVALID', 'paidAt must be an ISO-8601 timestamp', 400);
    if (paidAtMs > now.getTime() + 5 * 60_000) {
      throw invalid('PAID_AT_IN_FUTURE', 'paidAt cannot be in the future', 400);
    }
    if (statement.status === STATEMENT_STATUS.PAID) {
      if (statement.transferReference === reference) {
        return { statement, idempotent: true, releaseVisitLocks: false };
      }
      throw invalid('STATEMENT_ALREADY_PAID', 'Statement is already paid with a different transfer reference');
    }
    if (statement.status !== STATEMENT_STATUS.APPROVED) {
      throw invalid('STATEMENT_NOT_APPROVED', `Only an APPROVED statement can be marked paid (currently ${statement.status})`);
    }
    const paidAt = new Date(paidAtMs).toISOString();
    return {
      idempotent: false,
      releaseVisitLocks: false,
      statement: bumped(
        { transferReference: reference, paidAt, paidBy: actorId },
        STATEMENT_STATUS.PAID,
        { action: 'MARK_PAID', transferReference: reference, paidAt },
      ),
    };
  }

  const target = TARGET[action];
  if (statement.status === target) return { statement, idempotent: true, releaseVisitLocks: false };
  if (action !== 'APPROVE') {
    const reason = input.reason?.trim();
    if (!reason) throw invalid('REASON_REQUIRED', 'reason is required', 400);
  }
  if (!ALLOWED_FROM[action].includes(statement.status)) {
    throw invalid('STATEMENT_INVALID_TRANSITION', `Cannot ${action.toLowerCase()} a ${statement.status} statement`);
  }
  const reason = input.reason?.trim();
  return {
    idempotent: false,
    releaseVisitLocks: action === 'REJECT',
    statement: bumped({}, target, { action, ...(reason ? { reason } : {}) }),
  };
}
