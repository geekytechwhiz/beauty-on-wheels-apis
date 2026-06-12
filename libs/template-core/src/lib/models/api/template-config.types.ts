export type TemplateConfigRecord = {
  configId: string;
  document: Record<string, unknown>;
};

export type TemplateConfigListResult = {
  items: TemplateConfigRecord[];
};
