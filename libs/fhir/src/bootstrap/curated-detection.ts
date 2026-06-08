import type { DetectionConfig } from '../types/resource.types';



 

export const CURATED_DETECTION: Record<string, DetectionConfig> = {

  Patient: {

    enabled: true,

    strategy: 'ANY',

    fields: ['patientId', 'mrn'],

  },

  Practitioner: {

    enabled: true,

    strategy: 'ANY',

    fields: ['reporterName', 'reporterEmail'],

  },

  Organization: {

    enabled: true,

    strategy: 'ANY',

    fields: [

      'organizationId',

      'organizationID',

      'organizationName',

      'orgName',

      'accountAlias',

      'organizationInfo.organizationID',

      'organizationInfo.organizationName',

    ],

  },

  RelatedPerson: {

    enabled: true,

    strategy: 'ANY',

    fields: [

      'invitedBy',

      'caregiverName',

      'caregiverEmail',

      'caregiverPhone',

      'caregiverId',

    ],

  },

  Observation: {

    enabled: true,

    strategy: 'ANY',

    fields: [
      'vitalType',
      'deviceId',
      'attributes.systolic',
      'attributes.diastolic',
      'attributes.pulseRate',
      'attributes.vitalType',
    ],

  },

  Device: {

    enabled: true,

    strategy: 'ANY',

    fields: ['deviceId', 'configDeviceId', 'displayName', 'deviceCategory'],

  },

  Appointment: {

    enabled: true,

    strategy: 'ANY',

    fields: [

      'appointmentId',

      'scheduleId',

      'bookingId',

      'schedule.bookingId',

      'schedule.id',

    ],

  },

};

