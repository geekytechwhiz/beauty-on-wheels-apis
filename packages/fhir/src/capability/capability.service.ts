import { R4 } from '@ahryman40k/ts-fhir-types';

export interface CapabilityOptions {
  baseUrl?: string;
  profiles?: {
    Patient?: string[];
    Observation?: string[];
  };
}

export class CapabilityService {
  constructor(private readonly options: CapabilityOptions = {}) {}

  getMetadata(): R4.ICapabilityStatement {
    const now = new Date().toISOString();

    const restResource: R4.ICapabilityStatement_Resource[] = [
      {
        type: 'Patient',
        interaction: [
          { code: R4.CapabilityStatement_InteractionCodeKind._read },
          { code: R4.CapabilityStatement_InteractionCodeKind._searchType },
          { code: R4.CapabilityStatement_InteractionCodeKind._create },
        ],
        ...(this.options.profiles?.Patient && {
          supportedProfile: this.options.profiles.Patient,
        }),
      },
      {
        type: 'Observation',
        interaction: [
          { code: R4.CapabilityStatement_InteractionCodeKind._read },
          { code: R4.CapabilityStatement_InteractionCodeKind._searchType },
        ],
        ...(this.options.profiles?.Observation && {
          supportedProfile: this.options.profiles.Observation,
        }),
      },
    ];

    const capability: R4.ICapabilityStatement = {
      resourceType: 'CapabilityStatement',
      status: R4.CapabilityStatementStatusKind._active,
      date: now,
      kind: R4.CapabilityStatementKindKind._instance,
      // Use a cast here to avoid tight coupling to enum naming;
      // value matches R4 version string.
      fhirVersion: '4.0.1' as R4.CapabilityStatementFhirVersionKind,
      format: ['json'],
      rest: [
        {
          mode: R4.CapabilityStatement_RestModeKind._server,
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

