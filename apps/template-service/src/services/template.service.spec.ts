import type {
  TemplateDocumentLoader,
  TemplateMetadata,
  TemplateMetadataStore,
} from '@api-hub/template-core';
import type { S3TemplateStorage } from '@api-hub/template-storage';
import { TemplateService } from './template.service';

class MemoryMetadataStore implements TemplateMetadataStore {
  constructor(private readonly items: Map<string, TemplateMetadata>) {}

  private key(orgId: string, templateId: string, version: string): string {
    return `${orgId}#${templateId}#${version}`;
  }

  async getByKey(orgId: string, templateId: string, version: string): Promise<TemplateMetadata | null> {
    return this.items.get(this.key(orgId, templateId, version)) ?? null;
  }

  async listVersionsForTemplate(orgId: string, templateId: string): Promise<TemplateMetadata[]> {
    return [...this.items.values()].filter((t) => t.orgId === orgId && t.templateId === templateId);
  }

  async putMetadata(template: TemplateMetadata): Promise<void> {
    this.items.set(this.key(template.orgId, template.templateId, template.version), template);
  }
}

describe('TemplateService', () => {
  const now = new Date().toISOString();

  it('executeTemplate returns matched actions when rules pass', async () => {
    const meta: TemplateMetadata = {
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
        rules: { op: 'eq' as const, path: 'x', value: 1 },
        actions: [{ ok: true }],
      },
    };
    const store = new MemoryMetadataStore(new Map([['org1#T1#v1', meta]]));
    const mockStorage = {
      generateS3Key: jest.fn(),
      uploadTemplate: jest.fn(),
      getTemplate: jest.fn(),
    } as unknown as S3TemplateStorage;

    const loader: TemplateDocumentLoader = async (m) => {
      if (m.legacyInlineDocument) return m.legacyInlineDocument;
      throw new Error('no document');
    };

    const svc = new TemplateService(store, mockStorage, loader);
    const result = await svc.executeTemplate('org1', 'T1', { context: { x: 1 } });
    expect(result.matched).toBe(true);
    expect(result.actions).toEqual([{ ok: true }]);
  });
});
