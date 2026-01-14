import { z } from 'zod';

export const createUserSchema = z.object({
  userInfo: z.object({
    name: z.string().min(1),
    namePrefix: z.string().optional(),
    code: z.string().optional(),
    profilePic: z.union([
      z.string(),
      z.object({}).passthrough(),
    ]).optional().transform((val) => {
      if (!val) return undefined;
      if (typeof val === 'string') return val;
      if (typeof val === 'object' && val !== null) {
        // Extract string value from common object properties
        return (val as any).url || (val as any).profilePic || (val as any).value || (val as any).src || undefined;
      }
      return undefined;
    }),
    licenseNumber: z.string().optional(),
    contact: z.object({
      email: z.union([
        z.string().email(),
        z.literal(''),
        z.null(),
      ]).optional(),
      phone: z.union([
        z.string(),
        z.literal(''),
        z.null(),
      ]).optional(),
      phoneCode: z.string().optional(),
      address: z.object({
        address: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        postalCode: z.string().optional(),
        street: z.string().optional(),
        zip: z.string().optional(),
        countryCode: z.string().optional(),
        stateCode: z.string().optional(),
      }).optional(),
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
    }).optional(),
    dateOfBirth: z.string().optional(),
    department: z.string().optional(),
    gender: z.string().optional(),
    specialty: z.string().optional(),
    slotDurationInMinutes: z.number().optional(),
    experienceInYears: z.string().optional(),
    bio: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    emergencyContact: z.record(z.string(), z.unknown()).optional(),
    medicalHistory: z.record(z.string(), z.unknown()).optional(),
    insuranceDetails: z.record(z.string(), z.unknown()).optional(),
    workSchedule: z.record(z.string(), z.unknown()).optional(),
    position: z.string().optional(),
    userTimeZone: z.string().optional(),
  }),
  userRole: z.array(z.string()),
  userType: z.string(),
}).superRefine((data, ctx) => {
  const userTypeUpper = String(data.userType || '').toUpperCase();
  const email = data.userInfo.contact?.email;
  const phone = data.userInfo.contact?.phone;
  
  const hasEmail = email && typeof email === 'string' && email.trim() !== '';
  const hasPhone = phone && typeof phone === 'string' && phone.trim() !== '';
  
  // For STAFF, email is required
  if (userTypeUpper === 'STAFF') {
    if (!hasEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email is required for STAFF',
        path: ['userInfo', 'contact', 'email'],
      });
    }
  }
  
  // For USER and FNF, at least one of email or phone is required
  if (userTypeUpper === 'USER' || userTypeUpper === 'FNF') {
    if (!hasEmail && !hasPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either email address or phone number is required for USER and FNF userType',
        path: ['userInfo', 'contact'],
      });
    }
  }
});

export const updateUserSchema = z.object({
  userId: z.string(),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

export const assignUserToOrganizationSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
});

export const updateUserMetadataSchema = z.object({
  userId: z.string(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.object({})]),
  ),
});

export const userFileReferenceSchema = z.object({
  userId: z.string(),
  fileId: z.string(),
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

