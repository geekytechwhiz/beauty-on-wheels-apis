import type { GenerateTemplateStorageKeyParams } from '../../application';

export function generateS3Key(params: GenerateTemplateStorageKeyParams): string {
  const { orgId, templateId, version, type } = params;
  if (type === 'MASTER') {
    return `master/${templateId}/${version}/template.json`;
  }
  return `org/${orgId}/${templateId}/${version}/template.json`;
}
