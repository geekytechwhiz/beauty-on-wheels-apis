import { randomUUID } from 'crypto';

import {
  ConditionalWriteConflictError,
  ConflictError,
  ForbiddenError,
  LambdaRequest,
  NotFoundError,
  ValidationError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertAdmin } from '../auth/admin';
import {
  VendorScopedActor,
  assertVisitScope,
  resolveVendorScopedActor,
  toIssueActor,
} from '../auth/vendor-issue-access';
import {
  MAX_ISSUE_ATTACHMENTS,
  OpsIssueAction,
  applyOpsAction,
  createIssueRecord,
  issueObjectPrefix,
  requestHash,
  toOpsIssueResponse,
  toVendorIssueResponse,
} from '../domain/vendor-issue';
import { BookingError } from '../errors';
import { requestQuery } from '../http/request-query';
import { requireIdempotencyKey, requirePathParam } from '../http/idempotency';
import { SchedulingCrewGateway, getSchedulingCrewGateway } from '../integrations/scheduling-crews.client';
import { OperationalAccessGateway, getOperationalAccessGateway } from '../integrations/vendor.client';
import {
  CustomerPlansRepository,
  getCustomerPlansRepository,
} from '../repositories/customer-plans.repository';
import {
  VendorIssuesRepository,
  getVendorIssuesRepository,
} from '../repositories/vendor-issues.repository';
import {
  AssignSchema,
  AttachmentUploadUrlSchema,
  ConfirmAttachmentSchema,
  CreateIssueSchema,
  IssueStatusQuerySchema,
  RequestActionSchema,
  ResolveSchema,
  TriageSchema,
  parseBody,
} from '../schemas/vendor-issues.schema';
import {
  EvidenceStorage,
  extensionForContentType,
  getEvidenceStorage,
} from '../storage/evidence-storage';
import {
  OpsIssueResponse,
  VENDOR_ISSUE_STATUS,
  VendorIssueRecord,
  VendorIssueResponse,
  VendorIssueStatus,
} from '../types/vendor-issue.types';

const baseLogger = createLogger({ service: 'vendor-issues', redactPII: true });

/**
 * Vendor and crew issues. Filing, listing, or attaching to an issue never changes
 * a package visit; the only coupling is that an unresolved issue linked to a
 * visit blocks completion (see PackageVisitsService.applyComplete).
 */
export class VendorIssuesService {
  private readonly logger = createChildLogger(baseLogger, { service: 'VendorIssuesService' });

  constructor(
    private readonly issues: VendorIssuesRepository = getVendorIssuesRepository(),
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly crews: SchedulingCrewGateway = getSchedulingCrewGateway(),
    private readonly storage: () => EvidenceStorage = getEvidenceStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(request: LambdaRequest): Promise<VendorIssueResponse> {
    const actor = await this.actor(request);
    if (actor.kind === 'admin') {
      throw new ForbiddenError('Platform admins triage issues through /ops/issues');
    }
    const key = requireIdempotencyKey(request);
    const body = parseBody(CreateIssueSchema, request.body);

    let communityId = body.communityId;
    if (actor.kind === 'crew' && !body.visitId) {
      throw new ForbiddenError('Crew may only file issues for a visit assigned to their crew');
    }
    if (body.visitId) {
      const visit = await this.requireVisit(body.visitId);
      assertVisitScope(actor, visit);
      communityId = communityId ?? visit.communityId;
    }

    const hash = requestHash({ actor: actor.userId, vendorId: actor.vendorId, body });
    const replay = await this.replay(actor.vendorId, key, hash);
    if (replay) return toVendorIssueResponse(replay);

    const record = createIssueRecord({
      vendorId: actor.vendorId,
      visitId: body.visitId,
      communityId,
      commitmentId: body.commitmentId,
      type: body.type,
      description: body.description,
      requestedHelp: body.requestedHelp,
      actor: toIssueActor(actor),
      nowIso: this.now().toISOString(),
    });
    try {
      await this.issues.createIssue(record, { key, requestHash: hash });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        const raced = await this.replay(actor.vendorId, key, hash);
        if (raced) return toVendorIssueResponse(raced);
        throw new ConflictError('Issue could not be created; retry with the same Idempotency-Key');
      }
      throw error;
    }
    this.logger.info({
      event: 'vendor_issue_created',
      issueId: record.issueId,
      vendorId: record.vendorId,
      visitId: record.visitId,
      type: record.type,
    });
    return toVendorIssueResponse(record);
  }

  async list(request: LambdaRequest): Promise<{ items: VendorIssueResponse[] }> {
    const actor = await this.actor(request);
    const query = requestQuery(request);
    const status = parseStatus(query.status);
    const visitId = query.visitId?.trim() || undefined;

    let found: VendorIssueRecord[];
    if (visitId) {
      const visit = await this.requireVisit(visitId);
      assertVisitScope(actor, visit);
      found = await this.issues.listVisitIssues(actor.vendorId, visitId);
    } else {
      if (actor.kind === 'crew') {
        throw new ForbiddenError('Crew must filter issues by an assigned visitId');
      }
      found = await this.issues.listVendorIssues(actor.vendorId);
    }
    const items = found
      .filter((issue) => !status || issue.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toVendorIssueResponse);
    return { items };
  }

  async get(request: LambdaRequest): Promise<VendorIssueResponse> {
    const actor = await this.actor(request);
    const issue = await this.requireScopedIssue(actor, requirePathParam(request, 'issueId'));
    return toVendorIssueResponse(issue);
  }

  /** Presigned PUT for one attachment. Register it afterwards with the confirm route. */
  async attachmentUploadUrl(request: LambdaRequest): Promise<{ uploadUrl: string; objectKey: string; expiresAt: string }> {
    const actor = await this.actor(request);
    requireIdempotencyKey(request);
    this.assertCanModify(actor);
    const issue = await this.requireScopedIssue(actor, requirePathParam(request, 'issueId'));
    this.assertAttachable(issue);
    const body = parseBody(AttachmentUploadUrlSchema, request.body);
    const objectKey = `${issueObjectPrefix(issue.vendorId, issue.issueId)}${randomUUID()}.${extensionForContentType(body.contentType)}`;
    return this.storage().createUploadUrl({ objectKey, contentType: body.contentType });
  }

  /** Verifies the uploaded object exists, then records its metadata. Replays of the same key are no-ops. */
  async confirmAttachment(request: LambdaRequest): Promise<VendorIssueResponse> {
    const actor = await this.actor(request);
    requireIdempotencyKey(request);
    this.assertCanModify(actor);
    const issue = await this.requireScopedIssue(actor, requirePathParam(request, 'issueId'));
    const body = parseBody(ConfirmAttachmentSchema, request.body);
    if (!body.objectKey.startsWith(issueObjectPrefix(issue.vendorId, issue.issueId))) {
      throw new BookingError('INVALID_ATTACHMENT_KEY', 'objectKey was not issued for this issue', 400, 'objectKey', false);
    }
    if (issue.attachments.some((item) => item.objectKey === body.objectKey)) return toVendorIssueResponse(issue);
    this.assertAttachable(issue);
    const head = await this.storage().headObject(body.objectKey);
    if (!head) {
      throw new BookingError('ATTACHMENT_NOT_UPLOADED', 'No uploaded object exists for objectKey', 409, 'objectKey', false);
    }
    const nowIso = this.now().toISOString();
    const next: VendorIssueRecord = {
      ...issue,
      attachments: [...issue.attachments, { objectKey: body.objectKey, contentType: body.contentType, uploadedAt: nowIso }],
      history: [...issue.history, {
        at: nowIso,
        by: toIssueActor(actor),
        action: 'ATTACHMENT_ADDED',
        fromStatus: issue.status,
        toStatus: issue.status,
      }],
      updatedAt: nowIso,
      version: issue.version + 1,
    };
    await this.save(next, issue.version);
    return toVendorIssueResponse(next);
  }

  // --- Ops ---------------------------------------------------------------

  async opsList(request: LambdaRequest): Promise<{
    items: OpsIssueResponse[];
    pagination: {
      limitPerStatus: number;
      returned: number;
      mayHaveMore: boolean;
      total: number | null;
      totalAvailability: 'complete' | 'unavailable';
      reason: string;
    };
  }> {
    const started = Date.now();
    const adminId = assertAdmin(request);
    const status = parseStatus(requestQuery(request).status);
    const statuses: VendorIssueStatus[] = status
      ? [status]
      : [VENDOR_ISSUE_STATUS.OPEN, VENDOR_ISSUE_STATUS.TRIAGED, VENDOR_ISSUE_STATUS.ACTION_REQUIRED];
    const limit = 100;
    const pages = await Promise.all(statuses.map((value) => this.issues.listByStatus(value, limit)));
    const items = pages.flatMap((page) => page.items)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toOpsIssueResponse);
    const mayHaveMore = pages.some((page) => Boolean(page.lastEvaluatedKey));
    this.logger.info({
      event: 'ops_issues_listed',
      correlationId: (request.context as { correlationId?: string } | undefined)?.correlationId,
      service: 'booking-service',
      operation: 'GET /ops/issues',
      outcome: 'success',
      durationMs: Date.now() - started,
      count: items.length,
      actorId: adminId,
      mayHaveMore,
    });
    return {
      items,
      pagination: {
        limitPerStatus: limit,
        returned: items.length,
        mayHaveMore,
        total: mayHaveMore ? null : items.length,
        totalAvailability: mayHaveMore ? 'unavailable' : 'complete',
        reason: mayHaveMore
          ? 'At least one status partition has more rows than this read. returned is not the open-issue population.'
          : 'Every selected status partition was read to the end, so total is the population for those statuses.',
      },
    };
  }

  async opsAction(request: LambdaRequest, action: OpsIssueAction): Promise<OpsIssueResponse> {
    const adminId = assertAdmin(request);
    requireIdempotencyKey(request);
    const issueId = requirePathParam(request, 'issueId');
    const input = parseOpsBody(action, request.body);
    const issue = await this.issues.getIssueById(issueId);
    if (!issue) throw new NotFoundError('Issue not found');
    const result = applyOpsAction(
      issue,
      action,
      input,
      { userId: adminId, role: 'ADMIN' },
      this.now().toISOString(),
    );
    if (result.idempotent) return toOpsIssueResponse(result.issue);
    await this.save(result.issue, issue.version);
    this.logger.info({
      event: 'vendor_issue_ops_action',
      issueId,
      action,
      from: issue.status,
      to: result.issue.status,
      by: adminId,
    });
    return toOpsIssueResponse(result.issue);
  }

  // --- helpers -----------------------------------------------------------

  private actor(request: LambdaRequest): Promise<VendorScopedActor> {
    return resolveVendorScopedActor(request, requirePathParam(request, 'vendorId'), this.vendors, this.crews);
  }

  private assertCanModify(actor: VendorScopedActor): void {
    if (actor.kind === 'admin') throw new ForbiddenError('Platform admins cannot modify vendor issues here');
  }

  private assertAttachable(issue: VendorIssueRecord): void {
    if (issue.status === VENDOR_ISSUE_STATUS.RESOLVED) {
      throw new BookingError('ISSUE_RESOLVED', 'Resolved issues cannot take new attachments', 409, 'status', false);
    }
    if (issue.attachments.length >= MAX_ISSUE_ATTACHMENTS) {
      throw new BookingError('TOO_MANY_ATTACHMENTS', `An issue holds at most ${MAX_ISSUE_ATTACHMENTS} attachments`, 409, 'attachments', false);
    }
  }

  private async requireVisit(visitId: string) {
    const visit = await this.plans.getVisitById(visitId);
    if (!visit) throw new NotFoundError('Visit not found');
    return visit;
  }

  private async requireScopedIssue(actor: VendorScopedActor, issueId: string): Promise<VendorIssueRecord> {
    const issue = await this.issues.getIssue(actor.vendorId, issueId);
    if (!issue) throw new NotFoundError('Issue not found');
    if (actor.kind === 'crew') {
      if (!issue.visitId) throw new NotFoundError('Issue not found');
      assertVisitScope(actor, await this.requireVisit(issue.visitId));
    }
    return issue;
  }

  private async replay(vendorId: string, key: string, hash: string): Promise<VendorIssueRecord | null> {
    const existing = await this.issues.getIdempotency(vendorId, key);
    if (!existing) return null;
    if (existing.requestHash !== hash) {
      throw new BookingError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key was already used with a different request',
        409,
        undefined,
        false,
      );
    }
    const issue = await this.issues.getIssue(vendorId, existing.issueId);
    if (!issue) throw new NotFoundError('Issue not found');
    return issue;
  }

  private async save(next: VendorIssueRecord, expectedVersion: number): Promise<void> {
    try {
      await this.issues.saveIssue(next, expectedVersion);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Issue was updated concurrently; reload and retry');
      }
      throw error;
    }
  }
}

function parseStatus(value: string | undefined): VendorIssueStatus | undefined {
  if (!value) return undefined;
  const result = IssueStatusQuerySchema.safeParse(value);
  if (!result.success) throw new ValidationError('status must be OPEN, TRIAGED, ACTION_REQUIRED, or RESOLVED');
  return result.data;
}

function parseOpsBody(action: OpsIssueAction, body: unknown) {
  switch (action) {
    case 'triage': return parseBody(TriageSchema, body);
    case 'assign': return parseBody(AssignSchema, body);
    case 'resolve': return parseBody(ResolveSchema, body);
    default: return parseBody(RequestActionSchema, body);
  }
}

let service: VendorIssuesService;

export function getVendorIssuesService(): VendorIssuesService {
  if (!service) service = new VendorIssuesService();
  return service;
}
