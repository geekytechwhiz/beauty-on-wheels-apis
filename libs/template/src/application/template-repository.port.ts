import type { TemplateMetadata } from '../domain';

export interface TemplateRepository {
  getByKey(orgId: string, templateId: string, version: string): Promise<TemplateMetadata | null>;
  listVersionsForTemplate(orgId: string, templateId: string): Promise<TemplateMetadata[]>;
  putMetadata(template: TemplateMetadata): Promise<void>;
}

export type TemplateMetadataStore = TemplateRepository;
export type TemplateStore = TemplateRepository;
