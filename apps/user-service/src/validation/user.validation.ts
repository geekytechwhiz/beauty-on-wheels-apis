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
    }),
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
});

export const updateUserSchema = z.object({
  userInfo: z.object({
    name: z.string().min(1).optional(),
    namePrefix: z.string().optional(),
    code: z.string().optional(),
    profilePic: z.string().optional(),
    licenseNumber: z.string().optional(),
    contact: z.object({
      email: z.string().email().optional(),
      phone: z.string().optional(),
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
    }).optional(),
    workingHours: z.object({
      monday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
      tuesday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
      wednesday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
      thursday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
      friday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
      saturday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
      sunday: z.object({
        available: z.boolean().optional(),
        availableHours: z.array(z.object({
          from: z.string(),
          to: z.string(),
        })).optional(),
      }).optional(),
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
    devices: z.array(z.unknown()).optional(),
    assignRoomNo: z.string().optional(),
    username: z.string().optional(),
  }).optional(),
  userRole: z.array(z.string()).optional(),
  userType: z.string().optional(),
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

