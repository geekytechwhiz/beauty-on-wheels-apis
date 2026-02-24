export interface DeviceItem {
	name: string;
	displayName: string;
	noOfUsers?: number;
	category: number;
	countriesSupported?: string[];
	deviceId: string;
	deviceGroupId?: number;
	deviceIncludedGroupId?: number;
	deviceSecondaryIncludedGroupId?: number;
	useExtensionProtocol?: boolean;
	supportsUserAuthentication?: boolean;
	requiresPairing?: boolean;
	enabled?: boolean;
	isAutoSyncSupported?: boolean;
	autoSyncDelay?: number;
	deviceImage?: string;
	externalVideoLink?: string;
	animationLink?: string;
	pairingErrorAnimationLink?: string;
	templateId?: number;
	deviceDetails?: string;
	supportedVitals?: string[];
	ACDeviceInfoUserDataServiceUUIDKey?: string;
}

export interface Manufacturer {
	manufacturerName: string;
	companyIdentifier?: number;
	enabled?: boolean;
	enableAllDevices?: boolean;
	manufacturerImage?: string;
	devices: DeviceItem[];
}

export interface Category {
	categoryName: string;
	category: number;
	categoryEnabled?: boolean;
	categoryImage?: string;
	manufacturers: Manufacturer[];
}

export interface DevicesData {
	categories: Category[];
}

export interface DeviceDynamoDBItem {
	pk: string;
	sk: string;
	sk3: string;
	sk4: string;
	category: string;
	deviceId: string;
	name: string;
	displayName: string;
	enabled: boolean;
	countriesSupported: string[];
	supportedVitals: string[];
	ACDeviceInfoUserDataServiceUUIDKey: string;
	animationLink: string;
	autoSyncDelay: number;
	companyIdentifier: string;
	deviceDetails: string;
	deviceGroupId: string;
	deviceImage: string;
	deviceIncludedGroupId: string;
	deviceSecondaryIncludedGroupId: string;
	externalVideoLink: string;
	isAutoSyncSupported: boolean;
	manufacturerImage: string;
	manufacturerName: string;
	noOfUsers: number;
	pairingErrorAnimationLink: string;
	requiresPairing: boolean;
	supportsUserAuthentication: boolean;
	template: number;
	useExtensionProtocol: boolean;
}
