/**
 * Helper functions for organization service
 */

export function organizationPk(organizationId: string): string {
  return `ORG#${organizationId}`;
}

export function organizationDetailsSk(): string {
  return 'ORG_DETAILS';
}
export function organizationUsersSk(): string {
  return 'USER#';
}
export function organizationUserSk(userId: string): string {
  return `USER#${userId}`;
}

export function organizationMetadataSk(): string {
  return 'ORG_METADATA';
}

export function organizationFileSk(fileId: string): string {
  return `ORG_FILE#${fileId}`;
}

/** Org link: pk/sk for bidirectional link records (ORG_LINK#fromOrg / ORG_LINK#toOrg) */
export function organizationLinkPk(organizationId: string): string {
  return `ORG_LINK#${organizationId}`;
}

export function organizationLinkSk(linkedOrganizationId: string): string {
  return `ORG_LINK#${linkedOrganizationId}`;
}

/** Org update audit: pk/sk for ORG_UPDATES#orgId / UPDATES#timestamp */
export function organizationUpdatesPk(organizationId: string): string {
  return `ORG_UPDATES#${organizationId}`;
}

export function organizationUpdatesSk(timestamp: number): string {
  return `UPDATES#${timestamp}`;
}

/** Organization count partition key (pk = ORG_COUNT for count-by-type items) */
export const ORGANIZATION_COUNT_PK = 'ORG_COUNT';
