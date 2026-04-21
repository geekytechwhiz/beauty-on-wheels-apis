import { JsonRuleEngine } from '@api-hub/rule-engine';
import type { TemplateRepository, TemplateStorage } from '../../application';
import { buildTemplateDocumentLoader } from '../../application';
import { ExecuteTemplateUseCase } from './execute-template.use-case';
import { TemplateResolver } from '../template-resolver';
import type { TemplateEvent, TemplateMetadata, TemplateOutboxEventRecord } from '../../domain';

class MemoryTemplateRepository implements TemplateRepository {
  constructor(private readonly items: Map<string, TemplateMetadata>) {}

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

  async findPublishedByProfileKey(_orgId: string, _profileKey: string): Promise<TemplateMetadata | null> {
    return null;
  }

  async publishWithSupersedeAndOutbox(
    template: TemplateMetadata,
    _previous: TemplateMetadata | null,
    _event: TemplateEvent,
  ): Promise<void> {
    await this.putMetadata(template);
  }

  async putMetadata(template: TemplateMetadata): Promise<void> {
    this.items.set(this.key(template.orgId, template.templateId, template.version), template);
  }

  async putMetadataWithOutbox(template: TemplateMetadata, _event: TemplateEvent): Promise<void> {
    await this.putMetadata(template);
  }

  async listPendingEvents(_limit: number): Promise<TemplateOutboxEventRecord[]> {
    return [];
  }

  async markEventSent(_eventId: string, _sentAt: string): Promise<void> {
    return undefined;
  }
}

class MemoryTemplateStorage implements TemplateStorage {
  generateKey(): string {
    return 'unused';
  }

  async uploadTemplate(): Promise<void> {
    return undefined;
  }

  async getTemplate(): Promise<unknown> {
    throw new Error('unexpected storage read');
  }

  async copyTemplateToSnapshot(
    _sourceKey: string,
    params: { templateId: string; version: string; snapshotId: string },
  ): Promise<string> {
    return `snapshots/${params.templateId}/${params.version}/${params.snapshotId}.json`;
  }
}

describe('ExecuteTemplateUseCase', () => {
  it('returns matched actions when rules pass', async () => {
    const now = new Date().toISOString();
    const repository = new MemoryTemplateRepository(
      new Map([
        [
          'org1#T1#v1',
          {
            templateId: 'T1',
            orgId: 'org1',
            version: 'v1',
            type: 'ORG',
            status: 'PUBLISHED',
            schemaRef: '',
            createdAt: now,
            updatedAt: now,
            legacyInlineDocument: {
              config: {},
              rules: [
                {
                  id: 'RULE_TEMPLATE_001',
                  name: 'Match x equals one',
                  priority: 1,
                  enabled: true,
                  conditions: {
                    all: [{ fact: 'x', operator: 'equal', value: 1 }],
                  },
                  actions: [{ type: 'SET', target: 'outcome', value: { ok: true } }],
                  metadata: {
                    module: 'template',
                    version: 'v1',
                    templateId: 'T1',
                    createdFrom: 'test',
                  },
                },
              ],
              actions: [],
            },
          },
        ],
      ]),
    );
    const storage = new MemoryTemplateStorage();
    const resolver = new TemplateResolver(repository, buildTemplateDocumentLoader(storage));
    const useCase = new ExecuteTemplateUseCase(resolver, new JsonRuleEngine());

    const result = await useCase.execute({
      orgId: 'org1',
      templateId: 'T1',
      body: { context: { x: 1 } },
    });

    expect(result.matched).toBe(true);
    expect(result.actions).toEqual([{ type: 'SET', target: 'outcome', value: { ok: true } }]);
    expect(result.ruleEvaluation.appliedRuleIds).toEqual(['RULE_TEMPLATE_001']);
  });
});
