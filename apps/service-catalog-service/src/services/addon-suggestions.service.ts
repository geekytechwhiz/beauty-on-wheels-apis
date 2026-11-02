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
  ADDON_SUGGESTION_REVIEW_ACTION,
  ADDON_SUGGESTION_STATUS,
  AddonSuggestionEntity,
  AddonSuggestionLookupEntity,
  AddonSuggestionReviewAction,
  assertReviewable,
  addonSuggestionKeys,
  readIdempotencyKey,
  statusForReviewAction,
  toAddonSuggestionResponse,
  type AddonSuggestionResponse,
} from '../domain/addon-suggestion';
import {
  AddonSuggestionsRepository,
  getAddonSuggestionsRepository,
} from '../repositories/addon-suggestions.repository';
import {
  CategoriesRepository,
  getCategoriesRepository,
} from '../repositories/categories.repository';
import {
  getServicesRepository,
  ServicesRepository,
} from '../repositories/services.repository';
import {
  CreateAddonSuggestionInput,
  ReviewAddonSuggestionInput,
  validateCreateAddonSuggestion,
  validateReviewAddonSuggestion,
} from '../schemas/addon-suggestions.schema';
import { assertCatalogAdmin, approvalActor } from '../utils/helpers/catalog-admin';
import { assertCatalogVendorManager } from '../utils/helpers/catalog-vendor-manager';
import { requireVendorId } from '../domain/vendor-scope';

const baseLogger = createLogger({ service: 'addon-suggestions-service', redactPII: true });

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function historyAction(action: AddonSuggestionReviewAction): 'REQUEST_CHANGES' | 'APPROVED' | 'REJECTED' {
  switch (action) {
    case ADDON_SUGGESTION_REVIEW_ACTION.REQUEST_CHANGES:
      return 'REQUEST_CHANGES';
    case ADDON_SUGGESTION_REVIEW_ACTION.APPROVE:
      return 'APPROVED';
    case ADDON_SUGGESTION_REVIEW_ACTION.REJECT:
      return 'REJECTED';
    default:
      throw new ValidationError('Invalid review action');
  }
}

export class AddonSuggestionsService {
  private readonly logger = createChildLogger(baseLogger, { service: 'AddonSuggestionsService' });

  constructor(
    private readonly repository: AddonSuggestionsRepository = getAddonSuggestionsRepository(),
    private readonly categories: CategoriesRepository = getCategoriesRepository(),
    private readonly services: ServicesRepository = getServicesRepository(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(request: LambdaRequest): Promise<AddonSuggestionResponse> {
    const body = validateCreateAddonSuggestion(request);
    const { userId } = await assertCatalogVendorManager(request, body.vendorId);
    const idempotencyKey = readIdempotencyKey(request.event?.headers as Record<string, unknown> | undefined);
    const requestHash = hashOf(body);
    const existingIdempotency = await this.repository.getCreateIdempotency(body.vendorId, idempotencyKey);
    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        throw new ConflictError('Idempotency key is already in use');
      }
      const replay = await this.repository.getByVendor(body.vendorId, existingIdempotency.suggestionId);
      if (!replay) {
        throw new ConflictError('Idempotency key is already in use');
      }
      return toAddonSuggestionResponse(replay);
    }

    await this.assertServiceHierarchy(body);

    const nowIso = this.now().toISOString();
    const suggestionId = randomUUID();
    const item: AddonSuggestionEntity = {
      PK: addonSuggestionKeys.pk(body.vendorId),
      SK: addonSuggestionKeys.sk(suggestionId),
      GSI1PK: addonSuggestionKeys.gsi1Pk(),
      GSI1SK: addonSuggestionKeys.gsi1Sk(ADDON_SUGGESTION_STATUS.PENDING_REVIEW, nowIso, suggestionId),
      entityType: 'AddonSuggestion',
      suggestionId,
      vendorId: body.vendorId,
      categoryId: body.categoryId,
      serviceId: body.serviceId,
      name: body.name,
      description: body.description,
      durationMinutes: body.durationMinutes,
      proposedCustomerPriceMinor: body.proposedCustomerPriceMinor,
      packageCompatibilityNotes: body.packageCompatibilityNotes,
      status: ADDON_SUGGESTION_STATUS.PENDING_REVIEW,
      history: [{
        at: nowIso,
        actorId: userId,
        actorRole: 'VENDOR',
        action: 'SUBMITTED',
      }],
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const lookup: AddonSuggestionLookupEntity = {
      PK: addonSuggestionKeys.lookupPk(suggestionId),
      SK: addonSuggestionKeys.lookupSk(),
      vendorId: body.vendorId,
      entityType: 'AddonSuggestionLookup',
    };

    try {
      await this.repository.createSuggestion({
        suggestion: item,
        lookup,
        idempotency: {
          PK: addonSuggestionKeys.pk(body.vendorId),
          SK: addonSuggestionKeys.createIdempotencySk(idempotencyKey),
          entityType: 'AddonSuggestionIdempotency',
          requestHash,
          suggestionId,
          vendorId: body.vendorId,
        },
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Idempotency key is already in use');
      }
      throw error;
    }

    this.logger.info({ event: 'addon_suggestion_submitted', suggestionId, vendorId: body.vendorId });
    return toAddonSuggestionResponse(item);
  }

  async listForVendor(request: LambdaRequest): Promise<{ items: AddonSuggestionResponse[] }> {
    const vendorId = requireVendorId(request.params?.vendorId);
    await assertCatalogVendorManager(request, vendorId);
    const items = await this.repository.listByVendor(vendorId);
    return { items: items.map(toAddonSuggestionResponse) };
  }

  async getForVendor(request: LambdaRequest): Promise<AddonSuggestionResponse> {
    const vendorId = requireVendorId(request.params?.vendorId);
    await assertCatalogVendorManager(request, vendorId);
    const suggestionId = requiredSuggestionId(request);
    const item = await this.repository.getByVendor(vendorId, suggestionId);
    if (!item) {
      throw new NotFoundError(`Add-on suggestion not found: ${suggestionId}`);
    }
    return toAddonSuggestionResponse(item);
  }

  async opsList(request: LambdaRequest): Promise<{ items: AddonSuggestionResponse[] }> {
    assertCatalogAdmin(request);
    const raw = (request.params?.status ?? request.query?.status) as string | undefined;
    const status = parseStatus(raw ?? ADDON_SUGGESTION_STATUS.PENDING_REVIEW);
    const items = await this.repository.listByStatus(status, 100);
    return { items: items.map(toAddonSuggestionResponse) };
  }

  async review(request: LambdaRequest): Promise<AddonSuggestionResponse> {
    assertCatalogAdmin(request);
    const adminId = approvalActor(request);
    const idempotencyKey = readIdempotencyKey(request.event?.headers as Record<string, unknown> | undefined);
    const body = validateReviewAddonSuggestion(request);
    const suggestionId = requiredSuggestionId(request);
    const requestHash = hashOf({ suggestionId, ...body });
    const existingIdempotency = await this.repository.getReviewIdempotency(idempotencyKey);
    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        throw new ConflictError('Idempotency key is already in use');
      }
      return existingIdempotency.responseSnapshot as AddonSuggestionResponse;
    }

    const current = await this.repository.getBySuggestionId(suggestionId);
    if (!current) {
      throw new NotFoundError(`Add-on suggestion not found: ${suggestionId}`);
    }
    const nextStatus = statusForReviewAction(body.action);
    if (current.status === nextStatus) {
      return toAddonSuggestionResponse(current);
    }
    assertReviewable(current.status);

    const nowIso = this.now().toISOString();
    const note = body.note?.trim();
    const next: AddonSuggestionEntity = {
      ...current,
      GSI1SK: addonSuggestionKeys.gsi1Sk(nextStatus, current.createdAt, current.suggestionId),
      status: nextStatus,
      reviewNote: note || current.reviewNote,
      reviewedBy: adminId,
      reviewedAt: nowIso,
      history: [...current.history, {
        at: nowIso,
        actorId: adminId,
        actorRole: 'ADMIN',
        action: historyAction(body.action),
        ...(note ? { note } : {}),
      }],
      version: current.version + 1,
      updatedAt: nowIso,
    };

    const response = toAddonSuggestionResponse(next);
    try {
      await this.repository.updateSuggestion(next, current.version, {
        PK: addonSuggestionKeys.gsi1Pk(),
        SK: addonSuggestionKeys.reviewIdempotencySk(idempotencyKey),
        entityType: 'AddonSuggestionReviewIdempotency',
        requestHash,
        suggestionId,
        responseSnapshot: response as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (error instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Suggestion changed during review; reload and retry');
      }
      throw error;
    }

    this.logger.info({
      event: 'addon_suggestion_reviewed',
      suggestionId,
      status: nextStatus,
      by: adminId,
    });
    return response;
  }

  private async assertServiceHierarchy(body: CreateAddonSuggestionInput): Promise<void> {
    const category = await this.categories.findById(body.categoryId);
    if (!category?.active) {
      throw new NotFoundError(`Category not found: ${body.categoryId}`);
    }
    const service = await this.services.findById(body.categoryId, body.serviceId);
    if (!service || service.vendorId !== body.vendorId) {
      throw new NotFoundError(`Service not found: ${body.serviceId}`);
    }
    if (!service.active) {
      throw new BaseError(
        'Suggestions require an active service',
        409,
        'SERVICE_INACTIVE',
      );
    }
  }
}

function requiredSuggestionId(request: LambdaRequest): string {
  const raw = request.params?.suggestionId;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ValidationError('suggestionId is required');
  }
  return raw.trim();
}

function parseStatus(raw: string) {
  const values = Object.values(ADDON_SUGGESTION_STATUS);
  if (!values.includes(raw as (typeof values)[number])) {
    throw new ValidationError(`status must be one of: ${values.join(', ')}`);
  }
  return raw as (typeof values)[number];
}

let service: AddonSuggestionsService;

export function getAddonSuggestionsService() {
  if (!service) {
    service = new AddonSuggestionsService();
  }
  return service;
}
