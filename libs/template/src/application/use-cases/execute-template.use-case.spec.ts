import { JsonRuleEngine } from '@api-hub/rule-engine';
import type { TemplateRepository, TemplateStorage } from '../../application';
import { buildTemplateDocumentLoader } from '../../application';
import { ExecuteTemplateUseCase } from './execute-template.use-case';
import { TemplateResolver } from '../template-resolver';
import type { TemplateMetadata } from '../../domain';

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

  async putMetadata(template: TemplateMetadata): Promise<void> {
    this.items.set(this.key(template.orgId, template.templateId, template.version), template);
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
            status: 'published',
            schemaRef: '',
            createdAt: now,
            updatedAt: now,
            legacyInlineDocument: {
              config: {},
              rules: { op: 'eq', path: 'x', value: 1 },
              actions: [{ ok: true }],
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
    expect(result.actions).toEqual([{ ok: true }]);
  });
});
