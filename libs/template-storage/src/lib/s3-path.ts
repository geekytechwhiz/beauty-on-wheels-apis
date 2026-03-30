export type TemplateStorageType = 'MASTER' | 'ORG';

export interface GenerateS3KeyParams {
  orgId: string;
  templateId: string;
  version: string;
  type: TemplateStorageType;
}

/**
 * Structured S3 object keys (bucket comes from env).
 * MASTER → master/{templateId}/{version}/template.json
 * ORG → org/{orgId}/{templateId}/{version}/template.json
 */
export function generateS3Key(params: GenerateS3KeyParams): string {
  const { orgId, templateId, version, type } = params;
  if (type === 'MASTER') {
    return `master/${templateId}/${version}/template.json`;
  }
  return `org/${orgId}/${templateId}/${version}/template.json`;
}
