import {
  BindRuntimeTemplateUseCase,
  buildTemplateDocumentLoader,
  buildProfileKey,
  CreateTemplateUseCase,
  ProcessTemplateOutboxUseCase,
  PublishTemplateUseCase,
  UpdateTemplateUseCase,
  TEMPLATE_MASTER_ORG_ID,
  TemplateInvalidStateTransitionError,
  TemplateNotPublishedError,
  type RuntimeBindingRepository,
  type TemplateEvent,
  type TemplateEventPublisher,
  type TemplateIdempotencyStore,
  type TemplateMetadata,
  type TemplateOutboxEventRecord,
  type TemplateRepository,
  type RuntimeTemplateBinding,
  type TemplateStorage,
} from '@api-hub/template';

class MemoryTemplateRepository implements TemplateRepository {
  readonly outboxEvents: TemplateOutboxEventRecord[] = [];

  constructor(private readonly items = new Map<string, TemplateMetadata>()) {}

  private key(orgId: string, templateId: string, version: string): string {
    return `${orgId}#${templateId}#${version}`;
  }

  async getByKey(orgId: string, templateId: string, version: string): Promise<TemplateMetadata | null> {
    return this.items.get(this.key(orgId, templateId, version)) ?? null;
  }

  async listVersionsForTemplate(orgId: string, templateId: string): Promise<TemplateMetadata[]> {
    return [...this.items.values()].filter((item) => item.orgId === orgId && item.templateId === templateId);
  }

  async getLatestVersion(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    return (
      [...this.items.values()]
        .filter((item) => item.orgId === orgId && item.templateId === templateId)
        .sort((left, right) => right.version.localeCompare(left.version))[0] ?? null
    );
  }

  async getPublishedVersion(orgId: string, templateId: string): Promise<TemplateMetadata | null> {
    return (
      [...this.items.values()]
        .filter(
          (item) =>
            item.orgId === orgId &&
            item.templateId === templateId &&
            (item.status === 'PUBLISHED' || item.status === 'published'),
        )
        .sort((left, right) => right.version.localeCompare(left.version))[0] ?? null
    );
  }

  async findPublishedByProfileKey(orgId: string, profileKey: string): Promise<TemplateMetadata | null> {
    return (
      [...this.items.values()].find(
        (item) =>
          item.orgId === orgId &&
          item.profileKey === profileKey &&
          (item.status === 'PUBLISHED' || item.status === 'published'),
      ) ?? null
    );
  }

  async publishWithSupersedeAndOutbox(
    newMeta: TemplateMetadata,
    previousPublishedToDeactivate: TemplateMetadata | null,
    event: TemplateEvent,
  ): Promise<void> {
    if (previousPublishedToDeactivate) {
      const prev = previousPublishedToDeactivate;
      const prevKey = this.key(prev.orgId, prev.templateId, prev.version);
      const existing = this.items.get(prevKey);
      if (existing) {
        this.items.set(prevKey, { ...existing, status: 'INACTIVE' });
      }
    }
    await this.putMetadataWithOutbox(newMeta, event);
  }

  async putMetadata(template: TemplateMetadata): Promise<void> {
    this.items.set(this.key(template.orgId, template.templateId, template.version), template);
  }

  async putMetadataWithOutbox(template: TemplateMetadata, event: TemplateEvent): Promise<void> {
    await this.putMetadata(template);
    this.outboxEvents.push({
      eventId: `event-${this.outboxEvents.length + 1}`,
      payload: event,
      status: 'PENDING',
      createdAt: event.timestamp,
    });
  }

  async listPendingEvents(limit: number): Promise<TemplateOutboxEventRecord[]> {
    return this.outboxEvents.filter((event) => event.status === 'PENDING').slice(0, limit);
  }

  async markEventSent(eventId: string, sentAt: string): Promise<void> {
    const event = this.outboxEvents.find((item) => item.eventId === eventId);
    if (event) {
      event.status = 'SENT';
      event.sentAt = sentAt;
    }
  }
}

class MemoryTemplateStorage implements TemplateStorage {
  private readonly documents = new Map<string, unknown>();

  generateKey(params: { orgId: string; templateId: string; version: string; type: 'MASTER' | 'ORG' }): string {
    return `${params.type}/${params.orgId}/${params.templateId}/${params.version}.json`;
  }

  async uploadTemplate(key: string, json: unknown): Promise<void> {
    this.documents.set(key, json);
  }

  async getTemplate(key: string): Promise<unknown> {
    return this.documents.get(key);
  }

  async copyTemplateToSnapshot(
    sourceKey: string,
    params: { templateId: string; version: string; snapshotId: string },
  ): Promise<string> {
    const destKey = `snapshots/${params.templateId}/${params.version}/${params.snapshotId}.json`;
    const doc = this.documents.get(sourceKey);
    if (doc === undefined) {
      throw new Error(`copyTemplateToSnapshot: missing source ${sourceKey}`);
    }
    this.documents.set(destKey, doc);
    return destKey;
  }
}

class MemoryEventPublisher implements TemplateEventPublisher {
  readonly events: TemplateEvent[] = [];

  async publish(event: TemplateEvent): Promise<void> {
    this.events.push(event);
  }
}

class MemoryIdempotencyStore implements TemplateIdempotencyStore {
  private readonly store = new Map<string, unknown>();

  async getResult<T>(idempotencyKey: string): Promise<T | null> {
    return (this.store.get(idempotencyKey) as T | undefined) ?? null;
  }

  async saveResult<T>(idempotencyKey: string, result: T): Promise<void> {
    this.store.set(idempotencyKey, result);
  }
}

class MemoryRuntimeBindingRepository implements RuntimeBindingRepository {
  private readonly bindings = new Map<string, RuntimeTemplateBinding>();

  private key(patientId: string, templateId: string): string {
    return `${patientId}#${templateId}`;
  }

  async getRuntimeBinding(patientId: string, templateId: string): Promise<RuntimeTemplateBinding | null> {
    return this.bindings.get(this.key(patientId, templateId)) ?? null;
  }

  async bindRuntimeVersion(binding: RuntimeTemplateBinding): Promise<RuntimeTemplateBinding> {
    this.bindings.set(this.key(binding.patientId, binding.templateId), binding);
    return binding;
  }
}

describe('template event publishing', () => {
  it('publishes create and publish events while enforcing SAVED → IN_REVIEW → PUBLISHED', async () => {
    const repository = new MemoryTemplateRepository();
    const storage = new MemoryTemplateStorage();
    const eventPublisher = new MemoryEventPublisher();

    const loadDocument = buildTemplateDocumentLoader(storage);
    const createTemplateUseCase = new CreateTemplateUseCase(repository, storage, loadDocument, repository);
    const updateTemplateUseCase = new UpdateTemplateUseCase(
      repository,
      storage,
      loadDocument,
      repository,
    );
    const publishTemplateUseCase = new PublishTemplateUseCase(
      repository,
      loadDocument,
      storage,
      repository,
    );
    const processOutboxUseCase = new ProcessTemplateOutboxUseCase(repository, eventPublisher);

    const profile = {
      profileTemplateType: 'CARE_PLAN',
      category: 'c',
      condition: 'c',
      country: 'US',
    };
    const masterSchemaRef = 'MASTER/__MASTER__/mast/v0.json';

    repository.items.set(
      `${TEMPLATE_MASTER_ORG_ID}#mast#v0`,
      {
        templateId: 'mast',
        orgId: TEMPLATE_MASTER_ORG_ID,
        version: 'v0',
        type: 'MASTER',
        status: 'PUBLISHED',
        schemaRef: masterSchemaRef,
        profile,
        profileKey: buildProfileKey(TEMPLATE_MASTER_ORG_ID, profile),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    );
    await storage.uploadTemplate(masterSchemaRef, {
      config: { kind: 'care-plan' },
      rules: [],
      actions: [],
    });

    const created = await createTemplateUseCase.execute({
      orgId: 'org-1',
      body: {
        templateId: 'care-plan',
        type: 'ORG',
        extendsTemplateId: 'mast',
        extendsVersion: 'v0',
        extendsBaseOrgId: TEMPLATE_MASTER_ORG_ID,
        config: { kind: 'care-plan' },
        profile,
        rules: [],
        actions: [],
      },
    });

    expect(created.status).toBe('SAVED');
    expect(repository.outboxEvents[0]?.payload.type).toBe('Template.Created.v1');

    const inReview = await updateTemplateUseCase.execute({
      orgId: 'org-1',
      templateId: 'care-plan',
      body: { version: created.version, status: 'IN_REVIEW' },
    });

    expect(inReview.status).toBe('IN_REVIEW');

    const published = await publishTemplateUseCase.execute({
      orgId: 'org-1',
      templateId: 'care-plan',
      body: { version: inReview.version },
    });

    await processOutboxUseCase.execute();

    expect(published.status).toBe('PUBLISHED');
    expect(eventPublisher.events[0]?.type).toBe('Template.Created.v1');
    expect(eventPublisher.events[1]?.type).toBe('Template.Updated.v1');
    expect(eventPublisher.events[2]?.type).toBe('Template.Published.v1');

    await expect(
      publishTemplateUseCase.execute({
        orgId: 'org-1',
        templateId: 'care-plan',
        body: { version: inReview.version },
      }),
    ).rejects.toBeInstanceOf(TemplateInvalidStateTransitionError);
  });

  it('supports idempotent create and immutable runtime bindings', async () => {
    const repository = new MemoryTemplateRepository();
    const storage = new MemoryTemplateStorage();
    const idempotencyStore = new MemoryIdempotencyStore();
    const loadDocument = buildTemplateDocumentLoader(storage);
    const createTemplateUseCase = new CreateTemplateUseCase(
      repository,
      storage,
      loadDocument,
      idempotencyStore,
    );

    const profile = {
      profileTemplateType: 'CARE_PLAN',
      category: 'c',
      condition: 'c',
      country: 'US',
    };
    const masterSchemaRef = 'MASTER/__MASTER__/mast/v0.json';
    repository.items.set(
      `${TEMPLATE_MASTER_ORG_ID}#mast#v0`,
      {
        templateId: 'mast',
        orgId: TEMPLATE_MASTER_ORG_ID,
        version: 'v0',
        type: 'MASTER',
        status: 'PUBLISHED',
        schemaRef: masterSchemaRef,
        profile,
        profileKey: buildProfileKey(TEMPLATE_MASTER_ORG_ID, profile),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    );
    await storage.uploadTemplate(masterSchemaRef, {
      config: { kind: 'patient' },
      rules: [],
      actions: [],
    });

    const first = await createTemplateUseCase.execute({
      orgId: 'org-2',
      idempotencyKey: 'same-key',
      body: {
        templateId: 'patient-template',
        type: 'ORG',
        extendsTemplateId: 'mast',
        extendsVersion: 'v0',
        extendsBaseOrgId: TEMPLATE_MASTER_ORG_ID,
        config: { kind: 'patient' },
        rules: [],
        actions: [],
      },
    });

    const second = await createTemplateUseCase.execute({
      orgId: 'org-2',
      idempotencyKey: 'same-key',
      body: {
        templateId: 'patient-template',
        type: 'ORG',
        extendsTemplateId: 'mast',
        extendsVersion: 'v0',
        extendsBaseOrgId: TEMPLATE_MASTER_ORG_ID,
        config: { kind: 'patient' },
        rules: [],
        actions: [],
      },
    });

    expect(second).toEqual(first);
    expect(repository.outboxEvents).toHaveLength(1);

    const publishedKey = `org-2#patient-template#${first.version}`;
    const publishedMeta = repository.items.get(publishedKey);
    if (publishedMeta) {
      repository.items.set(publishedKey, { ...publishedMeta, status: 'PUBLISHED' });
    }

    const runtimeBindingRepository = new MemoryRuntimeBindingRepository();
    const bindRuntimeTemplateUseCase = new BindRuntimeTemplateUseCase(runtimeBindingRepository, repository);

    const binding = await bindRuntimeTemplateUseCase.execute({
      patientId: 'patient-1',
      templateId: 'patient-template',
      version: first.version,
      orgId: 'org-2',
    });

    expect(binding.version).toBe(first.version);

    await expect(
      bindRuntimeTemplateUseCase.execute({
        patientId: 'patient-1',
        templateId: 'patient-template',
        version: 'v99',
        orgId: 'org-2',
      }),
    ).rejects.toBeInstanceOf(TemplateNotPublishedError);
  });
});
