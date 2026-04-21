import type { TemplateType } from '../domain';

export interface GenerateTemplateStorageKeyParams {
  orgId: string;
  templateId: string;
  version: string;
  type: TemplateType;
}

export interface TemplateStorage {
  generateKey(params: GenerateTemplateStorageKeyParams): string;
  uploadTemplate(key: string, json: unknown): Promise<void>;
  getTemplate(key: string): Promise<unknown>;
  /**
   * Copies an existing object to an immutable snapshot path (unique key per snapshotId; never overwrite).
   * Returns the destination key.
   */
  copyTemplateToSnapshot(
    sourceKey: string,
    params: { templateId: string; version: string; snapshotId: string },
  ): Promise<string>;
}
