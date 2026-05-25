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
    enabled: false,
    strategy: 'ANY',
    fields: [],
  },
};
