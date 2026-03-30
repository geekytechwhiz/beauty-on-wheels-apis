/** Main table: PK = ORG#{orgId}, SK = TEMPLATE#{templateId}#VERSION#{version} */
export function orgPk(orgId: string): string {
  return `ORG#${orgId}`;
}

export function templateVersionSk(templateId: string, version: string): string {
  return `TEMPLATE#${templateId}#VERSION#${version}`;
}

/**
 * GSI1 (org-scoped template + versions): list all versions for a template within an org.
 * GSI1PK = ORG#{orgId}#TEMPLATE#{templateId}
 * GSI1SK = VERSION#{version}
 */
export function gsi1Pk(orgId: string, templateId: string): string {
  return `ORG#${orgId}#TEMPLATE#${templateId}`;
}

export function gsi1Sk(version: string): string {
  return `VERSION#${version}`;
}

export const ENTITY_TYPE = 'TEMPLATE' as const;
