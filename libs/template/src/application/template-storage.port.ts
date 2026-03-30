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
}
