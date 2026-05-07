import type { TemplateEvent, TemplateMetadata } from '../domain';

export interface TemplateRepository {
  getByKey(orgId: string, templateId: string, version: string): Promise<TemplateMetadata | null>;
  listVersionsForTemplate(orgId: string, templateId: string): Promise<TemplateMetadata[]>;
  getLatestVersion(orgId: string, templateId: string): Promise<TemplateMetadata | null>;
  getPublishedVersion(orgId: string, templateId: string): Promise<TemplateMetadata | null>;
  /** Current PUBLISHED row for this org profile (single slot). */
  findPublishedByProfileKey(orgId: string, profileKey: string): Promise<TemplateMetadata | null>;
  putMetadataWithOutbox(template: TemplateMetadata, event: TemplateEvent): Promise<void>;
  /**
   * Publishes a version: optionally deactivates the previously published row for the same profile in one transaction.
   */
  publishWithSupersedeAndOutbox(
    newMetadata: TemplateMetadata,
    previousPublishedToDeactivate: TemplateMetadata | null,
    event: TemplateEvent,
  ): Promise<void>;
  putMetadata(template: TemplateMetadata): Promise<void>;
}

export type TemplateMetadataStore = TemplateRepository;
export type TemplateStore = TemplateRepository;
