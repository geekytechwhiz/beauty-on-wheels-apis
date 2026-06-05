export interface OrgProfileMeta {
  id: string;
  name: string;
  active?: boolean;
  country?: string;
  updated?: string;
  description?: string | null;
}

export interface OrgProfileDdbRecord {
  pk: string;
  sk: string;
  entityType: 'ORG_PROFILE';
  meta: OrgProfileMeta;
}
