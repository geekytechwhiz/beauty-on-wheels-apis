export type TemplateUiMetaDocument = Record<string, unknown> & {
  id: string;
  titleKey?: string;
  subtitleKey?: string;
  fields?: Record<string, unknown>;
};

export type TemplateUiMetaListItem = {
  templateType: string;
  metaId: string;
  fileName: string;
  document: TemplateUiMetaDocument;
};

export type TemplateUiMetaGetResult = {
  metaId: string;
  templateType: string;
  fileName: string;
  document: TemplateUiMetaDocument;
};
