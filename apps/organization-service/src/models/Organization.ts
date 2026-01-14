export interface Organization {
  pk: string;
  sk: string;
  organizationId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  createdDate: number;
  modifiedDate: number;
  deleted?: boolean;
  itemType: 'ORG_DETAILS';
}
