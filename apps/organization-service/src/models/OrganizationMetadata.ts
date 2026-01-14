export interface OrganizationMetadata {
  pk: string;
  sk: string;
  organizationId: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
  itemType: 'ORG_METADATA';
}
