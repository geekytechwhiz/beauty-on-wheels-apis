import { z } from 'zod';
import { FilterType } from '../types/feature-types';

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
        z.string()
          .transform((val) => (typeof val === 'string' ? val.replace(/\^@/, '@') : val))
          .pipe(z.string().email()),
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
  organizationID: z.string(),
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

/**
 * Schema for /users/validateusers endpoint.
 * Currently validates that all three fields are non-empty strings.
 */
export const validateUserExistsSchema = z.object({
  provider: z.string().min(1, 'provider is required'),
  externalId: z.string().min(1, 'externalId is required'),
  tenantId: z.string().optional(),
});

export const updateUserSchema = z.object({
  userId: z.string().optional(),
  profilePic: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  phoneCode: z.string().optional(),
  name: z.string().optional(),
  fullName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  specialty: z.string().optional(),
  department: z.string().optional(),
  licenseNumber: z.string().optional(),
  bio: z.string().optional(),
  namePrefix: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  countryCode: z.string().optional(),
  action: z.string().optional(),
}).superRefine((data, ctx) => {
  // If namePrefix is "Dr", then specialty, department, and licenseNumber are required
  if (data.namePrefix && data.namePrefix.toLowerCase() === 'dr') {
    if (!data.specialty || data.specialty.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'specialty is required when namePrefix is Dr',
        path: ['specialty'],
      });
    }
    if (!data.department || data.department.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'department is required when namePrefix is Dr',
        path: ['department'],
      });
    }
    if (!data.licenseNumber || data.licenseNumber.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'licenseNumber is required when namePrefix is Dr',
        path: ['licenseNumber'],
      });
    }
  }
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

export const activateDeactivateUserSchema = z.object({
  action: z.enum(['ACTIVATE', 'DEACTIVATE'], { message: 'action must be ACTIVATE or DEACTIVATE' }),
  organizationID: z.string().optional(),
  patientUserId: z.string().optional(),
});

export const validateContactsSchema = z
  .object({
    emailAddress: z.union([z.string().email(), z.literal('')]).optional(),
    phoneNumber: z.string().optional(),
  })
  .refine(
    (data) =>
      (typeof data.emailAddress === 'string' && data.emailAddress.trim() !== '') ||
      (typeof data.phoneNumber === 'string' && data.phoneNumber.trim() !== ''),
    { message: 'At least one of emailAddress or phoneNumber is required' },
  );

export const getOrganizationUserCountSchema = z.object({
  organizationId: z.string().optional(),
  roleId: z.string().optional(),
  roleName: z.string().optional(),
  roleType: z.string().optional(),
  status: z.string().optional(),
});

/** Assign doctor (staff) to patient. Matches legacy assignDoctor API body. */
export const assignDoctorSchema = z.object({
  organizationId: z.string().min(1, 'organizationId is required'),
  sender: z.object({
    userId: z.string().min(1),
    name: z.string().optional(),
    email: z.string().optional(),
    userType: z.string().optional(),
    presenceStatus: z.string().optional(),
  }),
  receiver: z.object({
    userId: z.string().min(1),
    name: z.string().optional(),
    email: z.string().optional(),
    profileImage: z.string().optional(),
    userType: z.string().optional(),
    presenceStatus: z.string().optional(),
  }),
  isReferred: z.boolean().optional(),
}).refine(
  (data) => data.sender.userId !== data.receiver.userId,
  { message: 'Sender (doctor) and receiver (patient) must be different users', path: ['receiver'] },
);

/** List patients assigned to a doctor or all patients in organization (front desk view).
 * Supports query parameters for microservice standard:
 * - doctorId: optional, if provided returns doctor's patients
 * - organizationId: required
 * - showConsultations: optional boolean, if true includes previouslyConsulted field
 * - showActiveAppointment: optional boolean, if true returns only patients with active appointments
 */
export const listDoctorPatientsQuerySchema = z.object({
  filter: z.nativeEnum(FilterType)
  .transform((val) => val.toLowerCase()), 
  organizationID: z.string().min(1, 'organizationId is required'),
  userID: z.string().optional(),
  showActiveAppointment: z.boolean().optional(),
});


/** Legacy POST body schema for backward compatibility */
export const listDoctorPatientsSchema = z.object({
  organizationId: z.string().min(1, 'organizationId is required'),
  doctorId: z.string().optional(),
  showConsultations: z.boolean().optional(),
});

/** PUT assigned-packages: full replace of assignedPackages and assignedPackagesName for user in org. */
export const assignedPackagesSchema = z.object({
  assignedPackages: z.array(z.object({
    id: z.string(),
    name: z.string(),
    start: z.string().optional(),
    end: z.string().optional(),
  })).default([]),
  assignedPackagesName: z.array(z.string()).default([]),
});

export const updateRecentInviteSchema = z.object({ 
  patientId: z.string().min(1, 'patientId is required').optional(),
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
});
