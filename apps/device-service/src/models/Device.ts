export interface Device {
  deviceId: string;
  configDeviceId: string;
  displayName: string;
  deviceCategory: string;
  companyName: string;
  modelName: string;
  platform: string;
  macAddress?: string;
  localName?: string;
  isAutoSyncEnabled: boolean;
  isAutoSyncSupported: boolean;
  isSync: boolean;
  usesExtensionProtocol: boolean;
  supportsUserAuthentication: boolean;
  autoSyncDelay: number;
  userIndex?: number;
  noOfUsers: number;
  lastReadingTimeStamp?: number;
  lastSequenceNumber?: string;
  databaseUpdateFlag?: boolean;
  databaseChangeIncrement?: number;
  isDeviceDeleted?: boolean;
  iOSIdentifier?: string;
  isEagleDevice?: boolean;
  deviceCategoryNum?: string;
  deviceImage?: string;
}

export interface DeviceUserEntry {
  pk: string; // DEVICE_LIST#${userId}
  sk: string; // DETAILS#${configDeviceId}
  sk1: string; // DEVICE#${deviceCategory}
  sk2: string; // STATUS#ACTIVE or STATUS#INACTIVE
  userId: string;
  deviceId: string;
  configDeviceId: string;
  macAddress?: string;
  displayName: string;
  deviceCategory: string;
  companyName: string;
  modelName: string;
  platform: string;
  isAutoSyncEnabled: boolean;
  isAutoSyncSupported: boolean;
  isSync: boolean;
  userIndex?: number;
  noOfUsers: number;
  lastReadingTimeStamp?: number;
  lastSequenceNumber?: string;
  localName?: string;
  usesExtensionProtocol: boolean;
  supportsUserAuthentication: boolean;
  databaseUpdateFlag?: boolean;
  databaseChangeIncrement?: number;
  isDeviceDeleted?: boolean;
  iOSIdentifier?: string;
  autoSyncDelay: number;
  isEagleDevice?: boolean;
  deviceCategoryNum?: string;
  updates?: Array<{
    updatedBy: string;
    updatedAt: number;
  }>;
  createdDate: number;
  modifiedDate: number;
}

export interface OrgDevice {
  pk: string; // ORG_DEVICES#${organizationId} or ORG_DEVICES#${deviceId}
  sk: string; // ${deviceId} or ${organizationId}
  sk1: string; // ${device.category.toUpperCase().split(' ').join('_')}
  sk2: string; // ${device.name.toUpperCase().split(' ').join('_')}
  sk3: string; // ${device.category}#${device.name}
  organizationID: string;
  enabled: boolean;
  isAutoSyncSupported: boolean;
  name: string;
  category: string;
  deviceId: string;
  // Extended device details
  displayName?: string;
  deviceImage?: string;
  countriesSupported?: string[];
  manufacturerImage?: string;
  manufacturerName?: string;
  template?: number;
  deviceDetails?: string;
  supportedVitals?: string[];
  createdDate: number;
  modifiedDate: number;
}

/** DynamoDB item shape for ORG_DEVICES (full record with all extended fields). */
export interface OrgDeviceItem {
  pk: string;
  sk: string;
  category: string;
  countriesSupported: string[];
  createdDate: number;
  deviceDetails: string;
  deviceId: string;
  deviceImage: string;
  displayName: string;
  enabled: boolean;
  isAutoSyncSupported: boolean;
  manufacturerImage: string;
  manufacturerName: string;
  modifiedDate: number;
  name: string;
  organizationID: string;
  sk1: string;
  sk2: string;
  sk3: string;
  supportedVitals: string[];
  template: number;
}

export interface DeviceRecommendation {
  pk: string; // RECOMMEND
  sk: string; // ${deviceId.toUpperCase().split(' ').join('_')}#${patientUserId}
  sk1: string; // ${patientUserId}
  sk2: string; // ${doctorId}
  sk3: string; // ${organizationId}
  sk4: string; // ${deviceId.toUpperCase().split(' ').join('_')}
  sk5: string; // ${patientUserId}#${device.category}#${device.name}
  doctorData: {
    doctorName: string;
    doctorId: string;
    recommendTime: number;
  };
  organizationID: string;
  status: 'UNPAIRED' | 'PAIRED';
  deviceId: string;
  category: string;
  name: string;
  displayName?: string;
  patientUserId: string;
  createdDate: number;
  modifiedDate: number;
}

export interface GlobalDevice {
  pk: string; // DEVICE_LIST
  sk: string; // CATEGORY#${category}#${deviceId}
  sk3: string; // ${deviceId.toUpperCase().split(' ').join('_')}
  sk4: string; // ${category.toUpperCase()}
  enabled: boolean;
  category: string;
  name: string;
  deviceId: string;
  countriesSupported?: string[];
  [key: string]: unknown;
}

export type OrganizationDevice = {
  
  category: string;
  countriesSupported: string[];
  createdDate: number; // epoch timestamp
  deviceDetails: string;
  deviceId: string;
  deviceImage: string;
  displayName: string;
  enabled: boolean;
  isAutoSyncSupported: boolean;
  manufacturerImage: string;
  manufacturerName: string;
  modifiedDate: number; // epoch timestamp
  name: string;
  organizationID: string; 
  supportedVitals: string[];
  template: number;
};