export interface Functionality {
  key: string;
  displayKey: string;
  access: boolean;
}

export interface Feature {
  featureKey: string;
  displayKey: string;
  moduleKey: string;
  isActive: boolean;
  status?: string;
  moduleStatus?: string;
  itemType: string;
  functionalities: Functionality[];
}

export interface OrgFeature {
  featureKey: string;
  displayKey: string;
  moduleKey: string;
  isActive: boolean;
  functionalities: Functionality[];
  [key: string]: any;
}

// Runtime enum-like object for filter types, plus TS union type
export const FilterType = {
  STAFF: 'staff',
  ALL_PATIENT: 'all-patient',
  ASSIGNED_PATIENT: 'assigned-patient',
  LAB_PATIENT: 'lab-patient',
  ALL: 'all',
} as const;

export type FilterType = (typeof FilterType)[keyof typeof FilterType];
