export const TEMPLATE_MASTER_ORG_ID = '__MASTER__';

export type TemplateScope = 'org' | 'master';

export function resolveTemplateScope(scope: unknown): TemplateScope {
  return scope === 'master' ? 'master' : 'org';
}

export function resolveTemplateOrganizationId(
  requestOrganizationId: string,
  scope: TemplateScope,
): string {
  return scope === 'master' ? TEMPLATE_MASTER_ORG_ID : requestOrganizationId;
}
