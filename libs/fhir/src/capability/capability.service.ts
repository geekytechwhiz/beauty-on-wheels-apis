import {
  FhirCapabilityStatement,
  FhirCapabilityStatementResource,
} from '../types/fhir.types';

export interface CapabilityOptions {
  baseUrl?: string;
  profiles?: {
    Patient?: string[];
    Observation?: string[];
    Practitioner?: string[];
    RelatedPerson?: string[];
    Organization?: string[];
    PractitionerRole?: string[];
    Appointment?: string[];
  };
}

export class CapabilityService {
  constructor(private readonly options: CapabilityOptions = {}) {}

  getMetadata(): FhirCapabilityStatement {
    const now = new Date().toISOString();

    const restResource: FhirCapabilityStatementResource[] = [
      {
        type: 'Patient',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
          { code: 'create' },
        ],
        ...(this.options.profiles?.Patient && {
          supportedProfile: this.options.profiles.Patient,
        }),
      },
      {
        type: 'Observation',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
        ],
        ...(this.options.profiles?.Observation && {
          supportedProfile: this.options.profiles.Observation,
        }),
      },
      {
        type: 'Practitioner',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
          { code: 'create' },
        ],
        ...(this.options.profiles?.Practitioner && {
          supportedProfile: this.options.profiles.Practitioner,
        }),
      },
      {
        type: 'RelatedPerson',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
          { code: 'create' },
        ],
        ...(this.options.profiles?.RelatedPerson && {
          supportedProfile: this.options.profiles.RelatedPerson,
        }),
      },
      {
        type: 'Organization',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
        ],
        ...(this.options.profiles?.Organization && {
          supportedProfile: this.options.profiles.Organization,
        }),
      },
      {
        type: 'PractitionerRole',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
        ],
        ...(this.options.profiles?.PractitionerRole && {
          supportedProfile: this.options.profiles.PractitionerRole,
        }),
      },
      {
        type: 'Appointment',
        interaction: [
          { code: 'read' },
          { code: 'search-type' },
          { code: 'create' },
        ],
        ...(this.options.profiles?.Appointment && {
          supportedProfile: this.options.profiles.Appointment,
        }),
      },
    ];

    const capability: FhirCapabilityStatement = {
      resourceType: 'CapabilityStatement',
      status: 'active',
      date: now,
      kind: 'instance',
      fhirVersion: '4.0.1',
      format: ['json'],
      rest: [
        {
          mode: 'server',
          resource: restResource,
        },
      ],
    };

    if (this.options.baseUrl) {
      capability.implementation = {
        description: 'Minimal FHIR facade',
        url: this.options.baseUrl,
      };
    }

    return capability;
  }
}

