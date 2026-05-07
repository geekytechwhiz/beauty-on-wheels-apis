import { parseTemplateDocument } from '../domain';
import type { TemplateDocument } from '../domain';
import { TemplateSchemaRefMissingError } from '../shared';
import type { TemplateStorage } from './template-storage.port';

export function buildTemplateDocumentLoader(storage: TemplateStorage) {
  return async (meta: {
    schemaRef?: string;
    snapshotRef?: string;
    legacyInlineDocument?: TemplateDocument;
  }): Promise<TemplateDocument> => {
    if (meta.legacyInlineDocument) {
      return meta.legacyInlineDocument;
    }

    const ref = meta.snapshotRef?.trim() || meta.schemaRef?.trim();
    if (!ref) {
      throw new TemplateSchemaRefMissingError();
    }

    const raw = await storage.getTemplate(ref);
    return parseTemplateDocument(raw);
  };
}
