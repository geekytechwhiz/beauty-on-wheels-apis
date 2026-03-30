import type { TemplateMetadata } from './types';

/**
 * Persistence port for template metadata only (full JSON lives in S3 at schemaRef).
 */
export interface TemplateMetadataStore {
  getByKey(orgId: string, templateId: string, version: string): Promise<TemplateMetadata | null>;

  /** All versions for an org + template id (for latest resolution and version bump). */
  listVersionsForTemplate(orgId: string, templateId: string): Promise<TemplateMetadata[]>;

  putMetadata(template: TemplateMetadata): Promise<void>;
}

/** @deprecated Use {@link TemplateMetadataStore} */
export type TemplateStore = TemplateMetadataStore;
