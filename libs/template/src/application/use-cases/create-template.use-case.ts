import {
  mergeMetadataAndDocument,
  TemplateStateManager,
  TemplateVersionManager,
  type TemplateEvent,
  type TemplateDefinition,
  type TemplateDocument,
  type TemplateMetadata,
} from '../../domain';
import { buildProfileKey } from '../../domain/template-profile';
import { normalizeTemplateStatus } from '../../domain/template-status';
import { assertSafeTemplateRuleActions } from '../../validation/template-rule-actions.validator';
import { assertOrgChangesRespectMasterControls } from '../../validation/template-controls.validator';
import { TEMPLATE_MASTER_ORG_ID } from '../../policies';
import { TemplateHierarchyError, TemplateVersionExistsError } from '../../shared';
import type { CreateTemplateInput, TemplateDocumentLoader } from '../dto';
import type { TemplateIdempotencyStore } from '../template-idempotency.port';
import type { TemplateRepository } from '../template-repository.port';
import type { TemplateStorage } from '../template-storage.port';

export class CreateTemplateUseCase {
  constructor(
    private readonly repository: TemplateRepository,
    private readonly storage: TemplateStorage,
    private readonly loadDocument: TemplateDocumentLoader,
    private readonly idempotencyStore: TemplateIdempotencyStore = {
      getResult: async () => null,
      saveResult: async () => undefined,
    },
    private readonly stateManager = new TemplateStateManager(),
    private readonly versionManager = new TemplateVersionManager(),
  ) {}

  async execute(input: CreateTemplateInput): Promise<TemplateDefinition> {
    const idempotencyKey = input.idempotencyKey
      ? `create:${input.orgId}:${input.body.templateId}:${input.idempotencyKey}`
      : undefined;
    if (idempotencyKey) {
      const cached = await this.idempotencyStore.getResult<TemplateDefinition>(idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const now = new Date().toISOString();
    const storageOrgId =
      input.body.type === 'MASTER' ? TEMPLATE_MASTER_ORG_ID : input.orgId;
    const existing = await this.repository.listVersionsForTemplate(storageOrgId, input.body.templateId);
    const version = input.body.version ?? this.versionManager.getNextVersion(existing.map((item) => item.version));

    if (existing.some((item) => item.version === version)) {
      throw new TemplateVersionExistsError();
    }

    const document: TemplateDocument = {
      config: input.body.config,
      rules: input.body.rules ?? [],
      actions: input.body.actions ?? [],
    };

    assertSafeTemplateRuleActions(document.rules);

    let masterTemplateVersionId: string | undefined;
    if (input.body.type === 'ORG') {
      if (!input.body.extendsTemplateId || !input.body.extendsVersion) {
        throw new TemplateHierarchyError('ORG template must extend a published master template');
      }
      const baseOrg = input.body.extendsBaseOrgId ?? TEMPLATE_MASTER_ORG_ID;
      const base = await this.repository.getByKey(
        baseOrg,
        input.body.extendsTemplateId,
        input.body.extendsVersion,
      );
      if (!base) {
        throw new TemplateHierarchyError('Base master template not found');
      }
      if (normalizeTemplateStatus(base.status) !== 'PUBLISHED') {
        throw new TemplateHierarchyError('ORG template must extend a PUBLISHED master template');
      }
      masterTemplateVersionId = `${base.templateId}#${base.version}`;

      const masterDoc = await this.loadDocument(base);
      assertOrgChangesRespectMasterControls(
        masterDoc.config as Record<string, unknown>,
        document.config as Record<string, unknown>,
      );
    }

    const schemaRef = this.storage.generateKey({
      orgId: storageOrgId,
      templateId: input.body.templateId,
      version,
      type: input.body.type,
    });

    await this.storage.uploadTemplate(schemaRef, document);

    const initialStatus = this.stateManager.getInitialStatus(
      input.body.status !== undefined ? normalizeTemplateStatus(input.body.status as string) : undefined,
    );

    let profileKey: string | undefined;
    if (input.body.profile) {
      profileKey = buildProfileKey(storageOrgId, input.body.profile);
    }

    const metadata: TemplateMetadata = {
      templateId: input.body.templateId,
      orgId: storageOrgId,
      version,
      type: input.body.type,
      status: initialStatus,
      baseTemplateId: input.body.extendsTemplateId,
      baseVersion: input.body.extendsVersion,
      baseOrgId: input.body.extendsBaseOrgId,
      masterTemplateVersionId,
      profile: input.body.profile,
      profileKey,
      schemaRef,
      createdAt: now,
      updatedAt: now,
      createdBy: input.body.createdBy,
    };

    const event: TemplateEvent = {
      type: 'Template.Created.v1',
      templateId: metadata.templateId,
      orgId: metadata.orgId,
      version: metadata.version,
      timestamp: now,
      metadata: {
        status: metadata.status,
        templateType: metadata.type,
      },
    };
    await this.repository.putMetadataWithOutbox(metadata, event);
    const result = mergeMetadataAndDocument(metadata, document);
    if (idempotencyKey) {
      await this.idempotencyStore.saveResult(idempotencyKey, result);
    }
    return result;
  }
}
