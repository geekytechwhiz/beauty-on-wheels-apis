export interface OrganizationDevice {
  pk: string;
  sk: string;
  organizationId: string;
  deviceId: string;
  assignedAt: string;
  status?: string;
  itemType: 'ORG_DEVICE';
}
