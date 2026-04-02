import {
  mergeMetadataAndDocument,
  TemplateStateManager,
  TemplateVersionManager,
  type TemplateEvent,
  type TemplateDefinition,
  type TemplateDocument,
  type TemplateMetadata,
  type TemplateStatus,
} from '../../domain';
import { buildProfileKey } from '../../domain/template-profile';
import { normalizeTemplateStatus } from '../../domain/template-status';
import { requiresNewVersion } from '../../validation/requires-new-version';
import type { ValidationEngine } from '../../validation/validation-engine';
import { TEMPLATE_MASTER_ORG_ID } from '../../policies';
import {
  TemplateHierarchyError,
  TemplateNotFoundError,
  TemplateValidationError,
  TemplateVersionConflictError,
} from '../../shared';
import type { TemplateDocumentLoader, UpdateTemplateInput } from '../dto';
import type { TemplateIdempotencyStore } from '../template-idempotency.port';
import type { TemplateRepository } from '../template-repository.port';
import type { TemplateStorage } from '../template-storage.port';

export class UpdateTemplateUseCase {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly storage: TemplateStorage,
    private readonly loadDocument: TemplateDocumentLoader,
    private readonly validationEngine: ValidationEngine,
    private readonly idempotencyStore: TemplateIdempotencyStore = {
      getResult: async () => null,
      saveResult: async () => undefined,
    },
    private readonly stateManager = new TemplateStateManager(),
    private readonly versionManager = new TemplateVersionManager(),
  ) {}

  async execute(input: UpdateTemplateInput): Promise<TemplateDefinition> {
    const idempotencyKey = input.idempotencyKey
      ? `update:${input.orgId}:${input.templateId}:${input.body.version}:${input.idempotencyKey}`
      : undefined;
    if (idempotencyKey) {
      const cached = await this.idempotencyStore.getResult<TemplateDefinition>(idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const now = new Date().toISOString();
    const source = await this.repository.getByKey(input.orgId, input.templateId, input.body.version);

    if (!source) {
      throw new TemplateNotFoundError();
    }

    const sourceDocument = await this.loadDocument(source);
    const mergedDocument: TemplateDocument = {
      config: input.body.config ?? sourceDocument.config,
      rules: input.body.rules ?? sourceDocument.rules,
      actions: input.body.actions ?? sourceDocument.actions,
    };

    const nextExtendsId = input.body.extendsTemplateId ?? source.baseTemplateId;
    const nextExtendsVer = input.body.extendsVersion ?? source.baseVersion;
    const nextExtendsOrg = input.body.extendsBaseOrgId ?? source.baseOrgId;
    const extendsChanged =
      (input.body.extendsTemplateId !== undefined && input.body.extendsTemplateId !== source.baseTemplateId) ||
      (input.body.extendsVersion !== undefined && input.body.extendsVersion !== source.baseVersion) ||
      (input.body.extendsBaseOrgId !== undefined && input.body.extendsBaseOrgId !== source.baseOrgId);

    let masterTemplateVersionId = source.masterTemplateVersionId;
    let masterDocument: TemplateDocument | null = null;
    if (source.type === 'ORG') {
      if (!nextExtendsId || !nextExtendsVer) {
        throw new TemplateHierarchyError('ORG template must extend a master template');
      }
      if (extendsChanged) {
        const baseOrg = nextExtendsOrg ?? TEMPLATE_MASTER_ORG_ID;
        const base = await this.repository.getByKey(baseOrg, nextExtendsId, nextExtendsVer);
        if (!base) {
          throw new TemplateHierarchyError('Base master template not found');
        }
        if (normalizeTemplateStatus(base.status) !== 'PUBLISHED') {
          throw new TemplateHierarchyError('ORG template must extend a PUBLISHED master template');
        }
        masterTemplateVersionId = `${base.templateId}#${base.version}`;
      }

      const baseOrg = nextExtendsOrg ?? TEMPLATE_MASTER_ORG_ID;
      const masterMeta = await this.repository.getByKey(baseOrg, nextExtendsId, nextExtendsVer);
      if (!masterMeta) {
        throw new TemplateHierarchyError('Base master template not found');
      }
      masterDocument = await this.loadDocument(masterMeta);
    }

    const profile = input.body.profile ?? source.profile;
    await this.validationEngine.validateTemplate({
      orgId: input.orgId,
      document: mergedDocument,
      profile,
      masterDocument,
      validatePublishedLinks: false,
      ruleActionScope: 'draft',
    });

    const normSource = normalizeTemplateStatus(source.status);
    if (normSource === 'PUBLISHED') {
      if (!requiresNewVersion(sourceDocument, mergedDocument)) {
        throw new TemplateValidationError('Published templates are immutable; no meaningful changes detected');
      }
    }

    if (normSource === 'PUBLISHED' && input.body.status !== undefined) {
      const requested = normalizeTemplateStatus(input.body.status as string);
      if (requested === 'PUBLISHED') {
        throw new TemplateValidationError('Cannot publish via update; use publish endpoint');
      }
    }

    const allVersions = await this.repository.listVersionsForTemplate(input.orgId, input.templateId);
    const newVersion = this.versionManager.getNextVersion(allVersions.map((item) => item.version));

    if (allVersions.some((item) => item.version === newVersion)) {
      throw new TemplateVersionConflictError();
    }

    const schemaRef = this.storage.generateKey({
      orgId: source.orgId,
      templateId: input.templateId,
      version: newVersion,
      type: source.type,
    });

    await this.storage.uploadTemplate(schemaRef, mergedDocument);

    const profileKey = profile ? buildProfileKey(source.orgId, profile) : source.profileKey;

    let nextStatus: TemplateStatus;
    if (normSource === 'PUBLISHED') {
      nextStatus = 'SAVED';
    } else {
      const requested =
        input.body.status !== undefined ? normalizeTemplateStatus(input.body.status as string) : undefined;
      nextStatus =
        requested !== undefined ? this.stateManager.changeStatus(normSource, requested) : normSource;
    }

    const metadata: TemplateMetadata = {
      templateId: input.templateId,
      orgId: source.orgId,
      version: newVersion,
      type: source.type,
      status: nextStatus,
      baseTemplateId: nextExtendsId,
      baseVersion: nextExtendsVer,
      baseOrgId: nextExtendsOrg,
      masterTemplateVersionId,
      profile,
      profileKey,
      schemaRef,
      createdAt: source.createdAt,
      updatedAt: now,
      createdBy: source.createdBy,
    };

    const event: TemplateEvent = {
      type: 'Template.Updated.v1',
      templateId: metadata.templateId,
      orgId: metadata.orgId,
      version: metadata.version,
      timestamp: now,
      metadata: {
        status: metadata.status,
        templateType: metadata.type,
        sourceVersion: source.version,
      },
    };
    await this.repository.putMetadataWithOutbox(metadata, event);
    const result = mergeMetadataAndDocument(metadata, mergedDocument);
    if (idempotencyKey) {
      await this.idempotencyStore.saveResult(idempotencyKey, result);
    }
    return result;
  }
}
