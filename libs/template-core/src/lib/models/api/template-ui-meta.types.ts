import type { TemplateUiMetaType } from '../../constants/template-ui-meta.constants';

export type TemplateUiMetaDocument = Record<string, unknown> & {
  id: string;
  titleKey?: string;
  subtitleKey?: string;
  fields?: Record<string, unknown>;
};

export type TemplateUiMetaListItem = {
  templateType: TemplateUiMetaType;
  metaId: string;
  fileName: string;
  document: TemplateUiMetaDocument;
};

export type TemplateUiMetaGetResult = {
  metaId: string;
  templateType: TemplateUiMetaType;
  fileName: string;
  document: TemplateUiMetaDocument;
};
