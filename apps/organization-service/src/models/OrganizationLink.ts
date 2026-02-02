export interface OrganizationLink {
  pk: string;
  sk: string;
  sk1?: string;
  fromOrg: string;
  toOrg: string;
  createdDate: number;
  itemType?: 'ORG_LINK';
}
