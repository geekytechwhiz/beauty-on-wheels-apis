import { randomUUID } from 'crypto';

import {
  ConditionalWriteConflictError,
  ConflictError,
  LambdaRequest,
  NotFoundError,
} from '@api-hub/utils';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { assertAdmin } from '../auth/admin';
import { assertVisitScope, resolveVendorScopedActor } from '../auth/vendor-issue-access';
import { ForbiddenError } from '@api-hub/utils';
import { toVisitResponse } from '../domain/package-visit';
import {
  applyCompletionReview,
  assertEvidenceMutable,
  evidencePrefix,
} from '../domain/visit-completion';
import { BookingError } from '../errors';
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
import { parseCompletionReviewBody, parseEvidenceUploadUrlBody } from '../schemas/visit-completion.schema';
import {
  EvidenceStorage,
  extensionForContentType,
  getEvidenceStorage,
} from '../storage/evidence-storage';
import {
  PACKAGE_VISIT_STATUS,
  PackageVisitResponse,
  VISIT_VALIDATION_STATUS,
} from '../types/package-visit.types';

const baseLogger = createLogger({ service: 'visit-completion', redactPII: true });

export type OpsVisitReview = PackageVisitResponse;

/** Evidence upload URLs and the admin completion review. */
export class VisitCompletionService {
  private readonly logger = createChildLogger(baseLogger, { service: 'VisitCompletionService' });

  constructor(
    private readonly plans: CustomerPlansRepository = getCustomerPlansRepository(),
    private readonly issues: Pick<VendorIssuesRepository, 'listBlockingVisitIssues'> = getVendorIssuesRepository(),
    private readonly vendors: OperationalAccessGateway = getOperationalAccessGateway(),
    private readonly crews: SchedulingCrewGateway = getSchedulingCrewGateway(),
    private readonly storage: () => EvidenceStorage = getEvidenceStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * POST /vendors/{vendorId}/package-visits/{visitId}/evidence/upload-url
   * Returns 501 EVIDENCE_STORAGE_NOT_CONFIGURED when EVIDENCE_BUCKET is unset.
   */
  async evidenceUploadUrl(request: LambdaRequest): Promise<{ uploadUrl: string; objectKey: string; expiresAt: string }> {
    const actor = await resolveVendorScopedActor(
      request,
      requirePathParam(request, 'vendorId'),
      this.vendors,
      this.crews,
    );
    if (actor.kind === 'admin') throw new ForbiddenError('Only the vendor owner or assigned crew may upload evidence');
    requireIdempotencyKey(request);
    const visit = await this.plans.getVisitById(requirePathParam(request, 'visitId'));
    if (!visit) throw new NotFoundError('Visit not found');
    assertVisitScope(actor, visit);
    assertEvidenceMutable(visit);
    if (visit.status !== PACKAGE_VISIT_STATUS.IN_PROGRESS && visit.status !== PACKAGE_VISIT_STATUS.COMPLETED) {
      throw new BookingError(
        'VISIT_NOT_STARTED',
        'Evidence can be uploaded once the visit is in progress',
        409,
        'visitId',
        false,
      );
    }
    const body = parseEvidenceUploadUrlBody(request.body);
    const objectKey = `${evidencePrefix(visit.vendorId, visit.visitId)}${randomUUID()}.${extensionForContentType(body.contentType)}`;
    return this.storage().createUploadUrl({ objectKey, contentType: body.contentType });
  }

  /** POST /ops/package-visits/{visitId}/completion-review */
  async review(request: LambdaRequest): Promise<OpsVisitReview & { reviewNote?: string }> {
    const adminId = assertAdmin(request);
    requireIdempotencyKey(request);
    const visit = await this.plans.getVisitById(requirePathParam(request, 'visitId'));
    if (!visit) throw new NotFoundError('Visit not found');
    const body = parseCompletionReviewBody(request.body);

    const result = applyCompletionReview(visit, body, adminId, this.now().toISOString());
    if (result.idempotent) return withNote(result.visit);

    if (body.decision === VISIT_VALIDATION_STATUS.APPROVED) {
      const blocking = await this.issues.listBlockingVisitIssues(visit.visitId);
      if (blocking.length > 0) {
        throw new BookingError(
          'BLOCKING_ISSUE_OPEN',
          'Resolve the blocking issue linked to this visit before approving its completion',
          409,
          'visitId',
          false,
        );
      }
    }
    try {
      await this.plans.saveVisit(result.visit, visit.version);
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Visit was updated concurrently; reload and retry');
      }
      throw error;
    }
    // Settlement hook (MVP): there is no cross-service call. Finance reads this
    // event and supplies the eligible visits to vendor-service statement generation.
    this.logger.info({
      event: body.decision === 'APPROVED' ? 'package_visit_completion_approved' : 'package_visit_completion_rejected',
      visitId: visit.visitId,
      vendorId: visit.vendorId,
      planId: visit.planId,
      payoutEligible: result.visit.payoutEligible,
      reviewedBy: adminId,
    });
    return withNote(result.visit);
  }
}

function withNote(visit: Parameters<typeof toVisitResponse>[0]) {
  return { ...toVisitResponse(visit), ...(visit.reviewNote ? { reviewNote: visit.reviewNote } : {}) };
}

let service: VisitCompletionService;

export function getVisitCompletionService(): VisitCompletionService {
  if (!service) service = new VisitCompletionService();
  return service;
}
