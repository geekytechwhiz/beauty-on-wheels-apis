import { createHash } from 'crypto';

import {
  BaseError,
  ConditionalWriteConflictError,
  ConflictError,
  EntityIdGenerator,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import {
  LEDGER_SOURCE,
  LedgerEntry,
  MAX_STATEMENT_ENTRIES,
  PayoutAccountView,
  STATEMENT_STATUS,
  SettlementStatementDdbItem,
  SettlementStatementResponse,
  StatementAction,
  StatementStatus,
  applyStatementAction,
  settlementKeys,
  toStatementResponse,
  totalOf,
} from '../domain/settlement';
import { maskAccountNumber } from '../mappers/bank-and-branches.mapper';
import {
  SettlementLedgerRepository,
  getSettlementLedgerRepository,
} from '../repositories/settlement-ledger.repository';
import { VendorsRepository, getVendorsRepository } from '../repositories/vendors.repository';
import {
  ApproveStatementSchema,
  GenerateStatementSchema,
  MarkPaidSchema,
  ReasonSchema,
  parseBody,
} from '../schemas/settlement.schema';
import { assertAdminAccess } from '../utils/helpers/authorization';
import { assertVendorManager } from '../utils/helpers/vendor-manager';
import { getIdempotencyKey, getPathParam, getVendorId } from '../utils/helpers/vendor-request';

const baseLogger = createLogger({ service: 'settlement-ledger', redactPII: true });

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function conflict(code: string, message: string): BaseError {
  return new BaseError(message, 409, code, undefined, { retryable: false });
}

/**
 * Manual settlement ledger. Finance supplies the eligible visits and amounts; this service
 * records them, never moves money, and never marks a statement PAID except through an
 * explicit mark-paid call carrying a transfer reference.
 *
 * MVP gap: statement entries are admin-supplied. This service does not call Booking to
 * confirm each visit is payoutEligible; finance reads package_visit_completion_approved
 * events/logs (or the ops UI) to choose visits. A visit can be on only one live statement.
 */
export class SettlementLedgerService {
  private readonly logger = createChildLogger(baseLogger, { service: 'SettlementLedgerService' });

  constructor(
    private readonly ledger: SettlementLedgerRepository = getSettlementLedgerRepository(),
    private readonly vendors: Pick<VendorsRepository, 'getVendorById' | 'getBank'> = getVendorsRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(request: LambdaRequest): Promise<SettlementStatementResponse> {
    const adminId = assertAdminAccess(request);
    const key = getIdempotencyKey(request);
    const body = parseBody(GenerateStatementSchema, request.body);
    const vendor = await this.vendors.getVendorById(body.vendorId);
    if (!vendor) throw new NotFoundError('Vendor not found');

    const requestHash = hashOf(body);
    const existing = await this.ledger.getIdempotency(body.vendorId, key);
    if (existing) return this.replay(existing, requestHash);

    const nowIso = this.now().toISOString();
    const entries: LedgerEntry[] = body.entries.map((entry) => ({
      entryId: EntityIdGenerator.LedgerEntryId(),
      vendorId: body.vendorId,
      ...(entry.visitId ? { visitId: entry.visitId } : {}),
      amountMinor: entry.amountMinor,
      currency: 'INR',
      source: entry.source,
      status: 'PENDING_REVIEW',
      ...(entry.note ? { note: entry.note } : {}),
      createdAt: nowIso,
    }));
    if (entries.length > MAX_STATEMENT_ENTRIES) throw new ValidationError('Too many entries');
    const totalMinor = totalOf(entries);
    if (totalMinor <= 0) throw new ValidationError('Statement total must be greater than zero');

    const statementId = EntityIdGenerator.StatementId();
    const statement: SettlementStatementDdbItem = {
      PK: settlementKeys.pk(body.vendorId),
      SK: settlementKeys.statementSk(statementId),
      GSI1PK: settlementKeys.gsi1Pk(),
      GSI1SK: settlementKeys.gsi1Sk(STATEMENT_STATUS.PENDING_REVIEW, nowIso, statementId),
      statementId,
      vendorId: body.vendorId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      status: STATEMENT_STATUS.PENDING_REVIEW,
      entries,
      totalMinor,
      currency: 'INR',
      history: [{ at: nowIso, by: adminId, action: 'GENERATED', toStatus: STATEMENT_STATUS.PENDING_REVIEW }],
      generatedBy: adminId,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      entityType: 'SettlementStatement',
    };
    try {
      await this.ledger.createStatement({ statement, idempotency: { key, requestHash } });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const failed = error.failedTransactItemIndexes ?? [];
        if (failed.includes(0)) {
          const raced = await this.ledger.getIdempotency(body.vendorId, key);
          if (raced) return this.replay(raced, requestHash);
        }
        throw conflict(
          'VISIT_ALREADY_SETTLED',
          'One or more visits are already on a live settlement statement. Reject that statement first or remove the visit.',
        );
      }
      throw error;
    }
    this.logger.info({
      event: 'settlement_statement_generated',
      statementId,
      vendorId: body.vendorId,
      totalMinor,
      entryCount: entries.length,
      by: adminId,
    });
    return toStatementResponse(statement, await this.payoutAccount(body.vendorId));
  }

  async listForVendor(request: LambdaRequest): Promise<{ items: SettlementStatementResponse[] }> {
    const vendorId = getVendorId(request);
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor not found');
    assertVendorManager(request, vendor);
    const [items, account] = await Promise.all([
      this.ledger.listVendorStatements(vendorId),
      this.payoutAccount(vendorId),
    ]);
    return { items: items.map((item) => toStatementResponse(item, account)) };
  }

  async getForVendor(request: LambdaRequest): Promise<SettlementStatementResponse> {
    const vendorId = getVendorId(request);
    const vendor = await this.vendors.getVendorById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor not found');
    assertVendorManager(request, vendor);
    const statement = await this.ledger.getStatement(vendorId, getPathParam(request, 'statementId'));
    if (!statement) throw new NotFoundError('Settlement statement not found');
    return toStatementResponse(statement, await this.payoutAccount(vendorId));
  }

  async opsList(request: LambdaRequest): Promise<{ items: SettlementStatementResponse[] }> {
    assertAdminAccess(request);
    const raw = (request.params?.status ?? request.query?.status) as string | undefined;
    const statuses = raw ? [parseStatus(raw)] : [STATEMENT_STATUS.PENDING_REVIEW, STATEMENT_STATUS.APPROVED, STATEMENT_STATUS.HELD, STATEMENT_STATUS.DISPUTED];
    const found = (await Promise.all(statuses.map((status) => this.ledger.listByStatus(status, 100)))).flat();
    const accounts = new Map<string, PayoutAccountView | null>();
    for (const vendorId of new Set(found.map((item) => item.vendorId))) {
      accounts.set(vendorId, await this.payoutAccount(vendorId));
    }
    return { items: found.map((item) => toStatementResponse(item, accounts.get(item.vendorId) ?? null)) };
  }

  approve(request: LambdaRequest) { return this.act(request, 'APPROVE'); }
  hold(request: LambdaRequest) { return this.act(request, 'HOLD'); }
  dispute(request: LambdaRequest) { return this.act(request, 'DISPUTE'); }
  reject(request: LambdaRequest) { return this.act(request, 'REJECT'); }
  markPaid(request: LambdaRequest) { return this.act(request, 'MARK_PAID'); }

  private async act(request: LambdaRequest, action: StatementAction): Promise<SettlementStatementResponse> {
    const adminId = assertAdminAccess(request);
    getIdempotencyKey(request);
    const input = action === 'MARK_PAID'
      ? parseBody(MarkPaidSchema, request.body)
      : action === 'APPROVE'
        ? (({ note }) => ({ reason: note }))(parseBody(ApproveStatementSchema, request.body))
        : parseBody(ReasonSchema, request.body);
    const statement = await this.ledger.getStatementById(getPathParam(request, 'statementId'));
    if (!statement) throw new NotFoundError('Settlement statement not found');

    if (action === 'APPROVE' && statement.status !== STATEMENT_STATUS.APPROVED) {
      // A statement cannot be paid without a destination on file.
      if (!(await this.vendors.getBank(statement.vendorId))) {
        throw conflict('BANK_DETAILS_MISSING', 'The vendor has no bank details on file; it cannot be approved for payment');
      }
    }

    const result = applyStatementAction(statement, action, input, adminId, this.now());
    if (result.idempotent) return toStatementResponse(result.statement, await this.payoutAccount(statement.vendorId));

    try {
      await this.ledger.saveStatement({
        next: result.statement,
        expectedVersion: statement.version,
        ...(result.releaseVisitLocks
          ? { releaseVisitIds: statement.entries.flatMap((entry) => (entry.visitId && entry.source === LEDGER_SOURCE.COMPLETED_VISIT ? [entry.visitId] : [])) }
          : {}),
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Statement was updated concurrently; reload and retry');
      }
      throw error;
    }
    this.logger.info({
      event: 'settlement_statement_transition',
      statementId: statement.statementId,
      vendorId: statement.vendorId,
      action,
      from: statement.status,
      to: result.statement.status,
      by: adminId,
      ...(action === 'MARK_PAID' ? { transferReference: result.statement.transferReference } : {}),
    });
    return toStatementResponse(result.statement, await this.payoutAccount(statement.vendorId));
  }

  /** Masked like GET bank-details. The raw account number never leaves this method. */
  private async payoutAccount(vendorId: string): Promise<PayoutAccountView | null> {
    const bank = await this.vendors.getBank(vendorId);
    if (!bank) return null;
    const masked = maskAccountNumber(bank.accountNumber ?? '');
    return {
      accountHolderName: bank.accountHolderName ?? '',
      bankName: bank.bankName ?? '',
      ifscCode: bank.ifscCode ?? '',
      accountNumberMasked: masked.accountNumberMasked,
      accountNumberLast4: masked.accountNumberLast4,
    };
  }

  private async replay(
    existing: { requestHash: string; statementId: string; vendorId: string },
    requestHash: string,
  ): Promise<SettlementStatementResponse> {
    if (existing.requestHash !== requestHash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    }
    const statement = await this.ledger.getStatement(existing.vendorId, existing.statementId);
    if (!statement) throw new NotFoundError('Settlement statement not found');
    return toStatementResponse(statement, await this.payoutAccount(existing.vendorId));
  }
}

function parseStatus(value: string): StatementStatus {
  if ((Object.values(STATEMENT_STATUS) as string[]).includes(value)) return value as StatementStatus;
  throw new ValidationError(`status must be one of ${Object.values(STATEMENT_STATUS).join(', ')}`);
}

let service: SettlementLedgerService;

export function getSettlementLedgerService(): SettlementLedgerService {
  if (!service) service = new SettlementLedgerService();
  return service;
}
