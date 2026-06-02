export const TEMPLATE_CONFIG_TYPES = ['TEMPLATE', 'ORG'] as const;
export type TemplateConfigType = (typeof TEMPLATE_CONFIG_TYPES)[number];

export type TemplateConfigRecord = {
  configId: string;
  configType: TemplateConfigType;
  templateType?: string;
  configKey?: string;
  fileName: string;
  document: Record<string, unknown>;
};

export type TemplateConfigListResult = {
  items: TemplateConfigRecord[];
};
