/**
 * Helper functions for organization service
 */

export function organizationPk(organizationId: string): string {
  return `ORG#${organizationId}`;
}

export function organizationDetailsSk(): string {
  return 'ORG_DETAILS';
}

export function organizationUserSk(userId: string): string {
  return `ORG_USER#${userId}`;
}

export function organizationMetadataSk(): string {
  return 'ORG_METADATA';
}

export function organizationFileSk(fileId: string): string {
  return `ORG_FILE#${fileId}`;
}
