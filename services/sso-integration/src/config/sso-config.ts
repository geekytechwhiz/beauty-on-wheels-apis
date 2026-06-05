import { z } from 'zod';

// -----------------------------------------------------------------------------
// SSO Configuration Schema
// -----------------------------------------------------------------------------

const ssoConfigSchema = z.object({
  // Default doctor values
  doctor: z.object({
    specialty: z.string().default('general'),
    namePrefix: z.string().default('Dr'),
    licenseNumber: z.string().default(''),
    slotDurationInMinutes: z.number().default(15),
    bio: z.string().default(''),
    workingHours: z.object({
      available: z.boolean().default(true),
      availableHours: z.array(z.object({
        from: z.string().default('07:00'),
        to: z.string().default('21:00'),
      })).default([{ from: '07:00', to: '21:00' }]),
    }).default({
      available: true,
      availableHours: [{ from: '07:00', to: '21:00' }],
    }),
  }),
  
  // Default patient values
  patient: z.object({
    phoneCode: z.string().default(''), // South Africa default
    emergencyContact: z.object({
      name: z.string().default(''),
      relation: z.string().default(''),
      phone: z.string().default(''),
      phoneCode: z.string().default('+91'),
      email: z.string().default(''),
    }).default({
      name: '',
      relation: '',
      phone: '',
      phoneCode: '+260',
      email: '',
    }),
    friendNFamily: z.object({
      name: z.string().default(''),
      relation: z.string().default(''),
      phone: z.string().default(''),
      phoneCode: z.string().default('+91'),
      email: z.string().default(''),
    }).default({
      name: '',
      relation: '',
      phone: '',
      phoneCode: '+91',
      email: '',
    }),
    medicalHistory: z.object({
      allergies: z.array(z.unknown()).default([]),
      chronicDiseases: z.array(z.unknown()).default([]),
      symptoms: z.array(z.unknown()).default([]),
    }).default({
      allergies: [],
      chronicDiseases: [],
      symptoms: [],
    }),
  }),
  
  // Phone code mapping (if TruTech provides country codes)
  phoneCodeMapping: z.record(z.string(), z.string()).default({}),
});

export type SSOConfig = z.infer<typeof ssoConfigSchema>;

// -----------------------------------------------------------------------------
// Load SSO Configuration from Environment Variables
// -----------------------------------------------------------------------------

let cachedSSOConfig: SSOConfig | null = null;

export function loadSSOConfig(): SSOConfig {
  if (cachedSSOConfig) {
    return cachedSSOConfig;
  }

  // Hardcoded defaults (South Africa configuration)
  const defaults = {
    doctor: {
      specialty: 'general',
      namePrefix: 'Dr',
      licenseNumber: '',
      slotDurationInMinutes: 15,
      bio: '',
      workingHours: {
        available: true,
        availableHours: [
          {
            from: '07:00',
            to: '21:00',
          },
        ],
      },
    },
    patient: {
      phoneCode: '', // South Africa
      emergencyContact: {
        name: '',
        relation: '',
        phone: '',
        phoneCode: '',
        email: '',
      },
      friendNFamily: {
        name: '',
        relation: '',
        phone: '',
        phoneCode: '+91',
        email: '',
      },
      medicalHistory: {
        allergies: [],
        chronicDiseases: [],
        symptoms: [],
      },
    },
    phoneCodeMapping: {},
  };

  // Build config from environment variables (only required ones) with hardcoded defaults
  const configData = {
    doctor: {
      specialty: process.env.SSO_DOCTOR_SPECIALTY || defaults.doctor.specialty,
      namePrefix: process.env.SSO_DOCTOR_NAME_PREFIX || defaults.doctor.namePrefix,
      licenseNumber: process.env.SSO_DOCTOR_LICENSE_NUMBER || defaults.doctor.licenseNumber,
      slotDurationInMinutes: parseInt(process.env.SSO_DOCTOR_SLOT_DURATION || String(defaults.doctor.slotDurationInMinutes), 10),
      bio: process.env.SSO_DOCTOR_BIO || defaults.doctor.bio,
      workingHours: {
        available: process.env.SSO_DOCTOR_WORKING_HOURS_AVAILABLE !== 'false' ? defaults.doctor.workingHours.available : false,
        availableHours: [
          {
            from: process.env.SSO_DOCTOR_WORKING_HOURS_FROM || defaults.doctor.workingHours.availableHours[0].from,
            to: process.env.SSO_DOCTOR_WORKING_HOURS_TO || defaults.doctor.workingHours.availableHours[0].to,
          },
        ],
      },
    },
    patient: {
      phoneCode: process.env.SSO_PATIENT_PHONE_CODE || defaults.patient.phoneCode,
      emergencyContact: {
        name: process.env.SSO_PATIENT_EMERGENCY_CONTACT_NAME || defaults.patient.emergencyContact.name,
        relation: process.env.SSO_PATIENT_EMERGENCY_CONTACT_RELATION || defaults.patient.emergencyContact.relation,
        phone: process.env.SSO_PATIENT_EMERGENCY_CONTACT_PHONE || defaults.patient.emergencyContact.phone,
        phoneCode: process.env.SSO_PATIENT_EMERGENCY_CONTACT_PHONE_CODE || defaults.patient.emergencyContact.phoneCode,
        email: process.env.SSO_PATIENT_EMERGENCY_CONTACT_EMAIL || defaults.patient.emergencyContact.email,
      },
      friendNFamily: {
        name: process.env.SSO_PATIENT_FRIEND_N_FAMILY_NAME || defaults.patient.friendNFamily.name,
        relation: process.env.SSO_PATIENT_FRIEND_N_FAMILY_RELATION || defaults.patient.friendNFamily.relation,
        phone: process.env.SSO_PATIENT_FRIEND_N_FAMILY_PHONE || defaults.patient.friendNFamily.phone,
        phoneCode: process.env.SSO_PATIENT_FRIEND_N_FAMILY_PHONE_CODE || defaults.patient.friendNFamily.phoneCode,
        email: process.env.SSO_PATIENT_FRIEND_N_FAMILY_EMAIL || defaults.patient.friendNFamily.email,
      },
      medicalHistory: defaults.patient.medicalHistory,
    },
    phoneCodeMapping: defaults.phoneCodeMapping,
  };

  const result = ssoConfigSchema.safeParse(configData);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`SSO configuration validation failed: ${errors}`);
  }

  cachedSSOConfig = result.data;
  return cachedSSOConfig;
}

export function getSSOConfig(): SSOConfig {
  if (!cachedSSOConfig) {
    return loadSSOConfig();
  }
  return cachedSSOConfig;
}
