import { z } from 'zod';

// Third-party apps that don't require organization validation (by device category)
const THIRD_PARTY_APPS = ['GOOGLEFIT', 'APPLEHEALTH', 'FITBIT', 'GARMIN', 'MANUAL'];

// Third-party by company name (legacy patient-app pairing)
export const ALLOWED_THIRD_PARTY_APPS = ['GOOGLEFIT', 'APPLEHEALTH', 'FITBIT', 'GARMIN', 'MANUAL'];

// Device registration schema (POST /devices/register)
export const deviceRegistrationSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  devices: z
    .array(
      z.object({
        configDeviceId: z.string().min(1),
        displayName: z.string().min(1),
        deviceCategory: z.string().min(1),
        companyName: z.string().min(1),
        modelName: z.string().min(1),
        userId: z.string().optional(),
        userID: z.string().optional(),
        deviceCategoryNum: z.number().optional(),
        syncCategory: z.coerce.number().optional(),
      }),
    )
    .min(1),
});

// Patient-app device user registration (legacy pairing) – full payload, correct table mapping
export const deviceUserRegistrationSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  devices: z
    .array(
      z.object({
        configDeviceId: z.string().min(1),
        displayName: z.string().min(1),
        noOfUsers: z.number(),
        deviceCategory: z.string().min(1),
        companyName: z.string().min(1),
        modelName: z.string().min(1),
        usesExtensionProtocol: z.boolean(),
        supportsUserAuthentication: z.boolean(),
        platform: z.string().min(1),
        isAutoSyncEnabled: z.boolean(),
        isAutoSyncSupported: z.boolean(),
        autoSyncDelay: z.number(),
        isSync: z.boolean(),
        // optional / from app
        macAddress: z.string().optional(),
        localName: z.string().optional(),
        lastSequenceNumber: z.string().optional(),
        lastReadingTimeStamp: z.number().optional(),
        databaseUpdateFlag: z.boolean().optional(),
        databaseChangeIncrement: z.number().optional(),
        isDeviceDeleted: z.boolean().optional(),
        iOSIdentifier: z.string().optional(),
        userIndex: z.number().optional(),
        isEagleDevice: z.boolean().optional(),
        deviceCategoryNum: z.union([z.string(), z.number()]).optional(),
        syncCategory: z.coerce.number().optional(),
      }),
    )
    .min(1),
});

// Delete single device schema (POST /devices/delete)
export const deviceDeleteSchema = z.object({
  deviceId: z.string().min(1),
  userId: z.string().min(1).optional(),
});

// Delete multiple devices schema (POST /devices/delete-multiple)
export const deviceDeleteMultipleSchema = z.object({
  devices: z.array(z.string().min(1)).min(1),
  userId: z.string().min(1).optional(),
});

// Retrieve device list schema (POST /devices/list)
export const deviceListSchema = z.object({
  action: z.enum(['deviceCategory', 'organization', 'patient', 'recommend']).optional(),
  organizationID: z.string().optional(),
  organizationId: z.string().optional(), // Support both cases
  patientUserId: z.string().optional(), // For recommend action
  category: z.string().optional(),
  searchValue: z.string().optional(),
  deviceId: z.string().optional(),
  deviceType: z.string().optional(),
  userId: z.string().min(1).optional(),
  userID: z.string().min(1).optional(),
  countryCode: z.string().optional(),
});

// Get device list schema (POST /devices/search)
export const deviceSearchSchema = z.object({
  action: z.enum(['organization', 'patient', 'recommend', 'deviceCategory']),
  organizationID: z.string().optional(),
  userID: z.string().optional(),
  patientUserId: z.string().optional(),
  category: z.string().optional(),
  searchValue: z.string().optional(),
  countryCode: z.string().optional(),
});

// Organization device management schema (POST /devices/org/manage)
export const orgDeviceManageSchema = z.object({
  action: z.enum(['add', 'remove', 'update']),
  organizationId: z.string().min(1),
  devices: z
    .array(
      z.object({
        deviceId: z.string().min(1),
        category: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .min(1)
    .optional(),
  deviceId: z.string().optional(),
  enabled: z.boolean().optional(),
  isAutoSyncSupported: z.boolean().optional(),
  userID: z.string().optional(),
  organizationID: z.string().optional(),
});

// Add device recommendation schema (POST /devices/recommendations/add)
export const deviceRecommendationAddSchema = z.object({
  patientUserId: z.string().min(1),
  doctorName: z.string().min(1),
  devices: z
    .array(
      z.object({
        deviceId: z.string().min(1),
        category: z.string().min(1),
        name: z.string().min(1),
        displayName: z.string().optional(),
        deviceImage: z.string().optional(),
        countriesSupported: z.array(z.string()).optional(),
        manufacturerImage: z.string().optional(),
        manufacturerName: z.string().optional(),
        template: z.number().optional(),
        deviceDetails: z.string().optional(),
        supportedVitals: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  userID: z.string().optional(),
  doctorId: z.string().optional(), // Support doctorId field
  organizationID: z.string().optional(),
  organizationId: z.string().optional(), // Support both cases
});

// Remove device recommendations schema (POST /devices/recommendations/remove)
export const deviceRecommendationRemoveSchema = z.object({
  patientUserId: z.string().min(1),
  doctorName: z.string().min(1).optional(),
  devices: z.array(z.object({ deviceId: z.string().min(1) })).min(1),
});

// Global device registration schema (POST /devices/global/register)
export const globalDeviceRegistrationSchema = z.object({
  devices: z
    .array(
      z.object({
        deviceId: z.string().min(1),
        category: z.string().min(1),
        name: z.string().min(1),
        enabled: z.boolean().optional().default(true),
        countriesSupported: z.array(z.string()).optional(),
      }).passthrough(), // Allow additional fields from devices.json
    )
    .min(1),
});

// Error notification schema (POST /devices/error-notification) – Email/SMS/push
export const errorNotificationSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  deviceToken: z.string().optional(),
  name: z.string().optional(),
  channels: z.array(z.enum(['email', 'sms', 'push'])).optional().default(['email', 'sms', 'push']),
  template: z.string().optional(),
  templateData: z.record(z.string(), z.unknown()).optional(),
  deviceId: z.string().optional(),
  errorCode: z.string().optional(),
}).refine(
  (data) => data.email ?? data.phone ?? data.deviceToken ?? data.userId,
  { message: 'At least one of userId, email, phone, or deviceToken is required' }
);

// Helper function to check if device is third-party (by category)
export function isThirdPartyApp(deviceCategory: string): boolean {
  return THIRD_PARTY_APPS.includes(deviceCategory.toUpperCase());
}

// Helper: third-party by company name (legacy patient-app pairing)
export function isThirdPartyByCompanyName(companyName: string): boolean {
  return ALLOWED_THIRD_PARTY_APPS.includes((companyName || '').toUpperCase());
}
