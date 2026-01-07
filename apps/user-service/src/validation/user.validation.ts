import { z } from 'zod';

export const createUserSchema = z.object({
  userInfo: z.object({
    name: z.string().min(1),
    namePrefix: z.string().optional(),
    code: z.string().optional(),
    profilePic: z.string().optional(),
    licenseNumber: z.string().optional(),
    contact: z.object({
      email: z.string().email(),
      phone: z.string(),
      phoneCode: z.string().optional(),
    }),
    workingHours: z.object({
      monday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
      tuesday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
      wednesday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
      thursday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
      friday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
      saturday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
      sunday: z.object({
        available: z.boolean(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }),
    }),
    dateOfBirth: z.string().optional(),
    department: z.string().optional(),
    gender: z.string().optional(),
    specialty: z.string().optional(),
    slotDurationInMinutes: z.number().optional(),
    experienceInYears: z.string().optional(),
    bio: z.string().optional(),
  }),
  userRole: z.array(z.string()),
  userType: z.string(),
});

export const updateUserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

export const assignUserToOrganizationSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

export const updateUserMetadataSchema = z.object({
  userId: z.string().uuid(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.object({})]),
  ),
});

export const userFileReferenceSchema = z.object({
  userId: z.string().uuid(),
  fileId: z.string().uuid(),
  fileName: z.string(),
  s3Key: z.string(),
  uploadedAt: z.string(),
});

export const s3EventSchema = z.object({
  Records: z.array(
    z.object({
      s3: z.object({
        bucket: z.object({ name: z.string() }),
        object: z.object({ key: z.string() }),
      }),
    }),
  ),
});

export const sqsEventSchema = z.object({
  Records: z.array(
    z.object({
      messageId: z.string(),
      body: z.string(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

