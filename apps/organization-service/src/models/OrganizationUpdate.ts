export interface OrganizationUpdate {
  pk: string;
  sk: string;
  sk1?: string;
  sk2?: string;
  organizationID: string;
  createdDate: number;
  modifiedDate: number;
  createdBy: string;
  updates: string;
  itemType?: 'ORG_UPDATE';
}
