import { CanonicalPatient } from '@api-hub/canonical';
import { FhirAdapter } from '../fhir.adapter.interface';
import { defaultAdapterRegistry } from '../../registry/adapter.registry';
import {
  FhirAddress,
  FhirContactPoint,
  FhirHumanName,
  FhirPatient,
} from '../../types/fhir.types';

export interface PatientFhirAdapterConfig {
  baseUrl?: string;
}

export class PatientFHIRAdapter
  implements FhirAdapter<CanonicalPatient, FhirPatient>
{
  readonly resourceType = 'Patient';

  toFHIR(
    canonical: CanonicalPatient,
    config?: PatientFhirAdapterConfig
  ): FhirPatient {
    const name: FhirHumanName | undefined =
      canonical.givenName || canonical.familyName
        ? {
            use: 'official',
            given: canonical.givenName ? [canonical.givenName] : undefined,
            family: canonical.familyName,
          }
        : undefined;

    const telecom: FhirContactPoint[] = [];
    if (canonical.phoneNumber) {
      telecom.push({
        system: 'phone',
        value: canonical.phoneNumber,
      });
    }
    if (canonical.email) {
      telecom.push({
        system: 'email',
        value: canonical.email,
      });
    }

    const address: FhirAddress | undefined =
      canonical.addressLine ||
      canonical.city ||
      canonical.state ||
      canonical.postalCode ||
      canonical.country
        ? {
            line: canonical.addressLine ? [canonical.addressLine] : undefined,
            city: canonical.city,
            state: canonical.state,
            postalCode: canonical.postalCode,
            country: canonical.country,
          }
        : undefined;

    const lastUpdated =
      canonical.updatedAt ?? canonical.createdAt ?? new Date().toISOString();

    const patient: FhirPatient = {
      resourceType: 'Patient',
      id: canonical.id,
      active: canonical.active,
      meta: {
        lastUpdated,
        ...(config?.baseUrl && { source: config.baseUrl }),
      },
      identifier: canonical.externalId
        ? [
            {
              system: 'urn:external-id',
              value: canonical.externalId,
            },
          ]
        : undefined,
      name: name ? [name] : undefined,
      telecom: telecom.length ? telecom : undefined,
      gender: canonical.gender as FhirPatient['gender'],
      birthDate: canonical.birthDate,
      address: address ? [address] : undefined,
      managingOrganization: canonical.organizationId
        ? {
          reference: `Organization/${canonical.organizationId}`,
        }
        : undefined,
    };

    return patient;
  }
}

// Register default Patient adapter in the shared registry
defaultAdapterRegistry.register('Patient', new PatientFHIRAdapter());

