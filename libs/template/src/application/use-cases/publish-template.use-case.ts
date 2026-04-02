import {
  mergeMetadataAndDocument,
  TemplateStateManager,
  type TemplateEvent,
  type TemplateDefinition,
  type TemplateDocument,
  type TemplateMetadata,
} from '../../domain';
import { buildProfileKey } from '../../domain/template-profile';
import { normalizeTemplateStatus } from '../../domain/template-status';
import { computeSnapshotId } from '../../domain/template-snapshot';
import { TEMPLATE_MASTER_ORG_ID } from '../../policies';
import type { ValidationEngine } from '../../validation/validation-engine';
import {
  TemplateHierarchyError,
  TemplateInvalidStateTransitionError,
  TemplateNotFoundError,
  TemplateValidationError,
} from '../../shared';
import type { PublishTemplateInput, TemplateDocumentLoader } from '../dto';
import type { TemplateIdempotencyStore } from '../template-idempotency.port';
import type { TemplateRepository } from '../template-repository.port';
import type { TemplateStorage } from '../template-storage.port';

export class PublishTemplateUseCase {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly loadDocument: TemplateDocumentLoader,
    private readonly storage: TemplateStorage,
    private readonly validationEngine: ValidationEngine,
    private readonly idempotencyStore: TemplateIdempotencyStore = {
      getResult: async () => null,
      saveResult: async () => undefined,
    },
    private readonly stateManager = new TemplateStateManager(),
  ) {}

  async execute(input: PublishTemplateInput): Promise<TemplateDefinition> {
    const idempotencyKey = input.idempotencyKey
      ? `publish:${input.orgId}:${input.templateId}:${input.body.version}:${input.idempotencyKey}`
      : undefined;

    if (idempotencyKey) {
      const cached = await this.idempotencyStore.getResult<TemplateDefinition>(idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const source = await this.repository.getByKey(
      input.orgId,
      input.templateId,
      input.body.version,
    );

    if (!source) {
      throw new TemplateNotFoundError();
    }

    const normalized = normalizeTemplateStatus(source.status);
    if (normalized !== 'IN_REVIEW') {
      throw new TemplateInvalidStateTransitionError(
        `Template must be IN_REVIEW to publish (current: ${normalized})`,
      );
    }

    const document = await this.loadDocument(source);

    if (!source.profile) {
      throw new TemplateValidationError('Template profile is required before publish');
    }

    let masterDocument: TemplateDocument | null = null;
    if (source.type === 'ORG') {
      if (!source.baseTemplateId || !source.baseVersion) {
        throw new TemplateHierarchyError('ORG template must extend a master template');
      }
      const baseOrg = source.baseOrgId ?? TEMPLATE_MASTER_ORG_ID;
      const masterMeta = await this.repository.getByKey(
        baseOrg,
        source.baseTemplateId,
        source.baseVersion,
      );
      if (!masterMeta) {
        throw new TemplateHierarchyError('Base master template not found');
      }
      masterDocument = await this.loadDocument(masterMeta);
    }

    await this.validationEngine.validateTemplate({
      orgId: input.orgId,
      document,
      profile: source.profile,
      masterDocument,
      validatePublishedLinks: true,
      ruleActionScope: 'publish',
    });

    const profileKey = buildProfileKey(source.orgId, source.profile);

    const snapshotId = computeSnapshotId(document);
    const snapshotRef = await this.storage.copyTemplateToSnapshot(source.schemaRef, {
      templateId: source.templateId,
      version: source.version,
      snapshotId,
    });

    const now = new Date().toISOString();
    const previousPublished = await this.repository.findPublishedByProfileKey(input.orgId, profileKey);
    let previousToDeactivate: TemplateMetadata | null = null;
    if (previousPublished) {
      if (
        previousPublished.templateId !== source.templateId ||
        previousPublished.version !== source.version
      ) {
        previousToDeactivate = previousPublished;
      }
    }

    const publishedMetadata: TemplateMetadata = {
      ...source,
      status: this.stateManager.publish(normalized),
      profile: source.profile,
      profileKey,
      snapshotRef,
      snapshotId,
      updatedAt: now,
    };

    const event: TemplateEvent = {
      type: 'Template.Published.v1',
      templateId: publishedMetadata.templateId,
      orgId: publishedMetadata.orgId,
      version: publishedMetadata.version,
      timestamp: now,
      metadata: {
        status: publishedMetadata.status,
        templateType: publishedMetadata.type,
        snapshotId: publishedMetadata.snapshotId,
        profileKey: publishedMetadata.profileKey,
      },
    };

    await this.repository.publishWithSupersedeAndOutbox(
      publishedMetadata,
      previousToDeactivate,
      event,
    );

    const result = mergeMetadataAndDocument(publishedMetadata, document);

    if (idempotencyKey) {
      await this.idempotencyStore.saveResult(idempotencyKey, result);
    }
    return result;
  }
}
