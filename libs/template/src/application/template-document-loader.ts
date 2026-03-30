import { parseTemplateDocument } from '../domain';
import type { TemplateDocument } from '../domain';
import { TemplateSchemaRefMissingError } from '../shared';
import type { TemplateStorage } from './template-storage.port';

export function buildTemplateDocumentLoader(storage: TemplateStorage) {
  return async (meta: { schemaRef?: string; legacyInlineDocument?: TemplateDocument }): Promise<TemplateDocument> => {
    if (meta.legacyInlineDocument) {
      return meta.legacyInlineDocument;
    }

    if (!meta.schemaRef?.trim()) {
      throw new TemplateSchemaRefMissingError();
    }

    const raw = await storage.getTemplate(meta.schemaRef);
    return parseTemplateDocument(raw);
  };
}
