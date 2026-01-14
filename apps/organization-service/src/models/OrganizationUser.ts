export interface OrganizationUser {
  pk: string;
  sk: string;
  organizationId: string;
  userId: string;
  assignedAt: string;
  role?: string;
  status?: string;
  itemType: 'ORG_USER';
}
