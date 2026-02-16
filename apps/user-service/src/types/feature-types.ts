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
