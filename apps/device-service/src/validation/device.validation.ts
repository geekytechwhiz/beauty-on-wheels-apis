import { z } from 'zod';

// Third-party apps that don't require organization validation
const THIRD_PARTY_APPS = ['GOOGLEFIT', 'APPLEHEALTH', 'FITBIT', 'GARMIN', 'MANUAL'];

// Device registration schema (POST /devices/register)
export const deviceRegistrationSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  devices: z
    .array(
      z.object({
        configDeviceId: z.string().min(1),
        displayName: z.string().min(1),
        noOfUsers: z.number().int().positive(),
        deviceCategory: z.string().min(1),
        companyName: z.string().min(1),
        modelName: z.string().min(1),
        usesExtensionProtocol: z.boolean(),
        supportsUserAuthentication: z.boolean(),
        platform: z.string().min(1),
        isAutoSyncEnabled: z.boolean(),
        isAutoSyncSupported: z.boolean(),
        autoSyncDelay: z.number().int().nonnegative(),
        isSync: z.boolean(),
        macAddress: z.string().optional(),
        localName: z.string().optional(),
        lastSequenceNumber: z.string().optional(),
        lastReadingTimeStamp: z.union([z.string(), z.number()]).optional(),
        databaseUpdateFlag: z.boolean().optional(),
        databaseChangeIncrement: z.number().optional(),
        isDeviceDeleted: z.boolean().optional(),
        iOSIdentifier: z.string().optional(),
        isEagleDevice: z.boolean().optional(),
        userIndex: z.number().int().nonnegative().optional(),
        deviceCategoryNum: z.string().optional(),
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
  deviceId: z.string().optional(),
  deviceType: z.string().optional(),
  userId: z.string().min(1).optional(),
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
  devices: z
    .array(
      z.object({
        deviceId: z.string().min(1),
        category: z.string().min(1),
        name: z.string().min(1),
      }),
    )
    .min(1),
  doctorName: z.string().min(1),
  userID: z.string().optional(),
  organizationID: z.string().optional(),
});

// Remove device recommendation schema (POST /devices/recommendations/remove)
export const deviceRecommendationRemoveSchema = z.object({
  patientUserId: z.string().min(1),
  deviceId: z.string().min(1),
});

// Helper function to check if device is third-party
export function isThirdPartyApp(deviceCategory: string): boolean {
  return THIRD_PARTY_APPS.includes(deviceCategory.toUpperCase());
}
