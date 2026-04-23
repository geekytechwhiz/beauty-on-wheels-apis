import { MappingResolver } from '../resolver/mapping.resolver';
import {
  defaultMappingRegistry,
  ResourceMappingConfig
} from '../registry/mapping.registry';

import { GenericFhirMapper } from '../mapper/generic-fhir.mapper';

import {
  defaultTerminologyService,
  TerminologyService
} from '@api-hub/terminology';

export interface FhirTransformationConfig {
  baseUrl?: string;
  validate?: boolean;
  clientConfig?: Record<string, unknown>;
}

export class FhirTransformationService {

  constructor(
    private readonly mappingResolver: MappingResolver =
      new MappingResolver(defaultMappingRegistry),

    private readonly genericMapper: GenericFhirMapper =
      new GenericFhirMapper(),

    private readonly terminology: TerminologyService =
      defaultTerminologyService
  ) {}

  /**
   * Generic Canonical → FHIR transformation
   */
  async transformCanonicalToFhir<TCanonical>(
    resourceType: string,
    canonical: TCanonical,
    clientId?: string,
    config: FhirTransformationConfig = {}
  ): Promise<any> {

    // console.log('transformCanonicalToFhir', JSON.stringify(canonical, null, 2));
    console.log('resourceType', resourceType);

    const mapping: ResourceMappingConfig | undefined =
      this.mappingResolver.resolve(resourceType, clientId ?? '');

    if (!mapping) {

      const error: any = new Error(
        `No mapping configured for resourceType=${resourceType}`
      );

      error.statusCode = 500;
      error.code = 'FHIR_MAPPING_NOT_FOUND';

      throw error;

    }

    /**
     * Step 1 — Canonical → FHIR mapping
     */
    const source =
      resourceType === 'Patient' || resourceType === 'Practitioner'
        ? this.normalizeCanonicalForPatient(canonical as Record<string, unknown>)
        : (canonical as Record<string, unknown>);

    const resource = this.genericMapper.map(source, mapping);

    if (resourceType === 'Patient' || resourceType === 'Practitioner') {
      this.pruneIncompletePatientArrays(resource);
    }

    /**
     * Step 2 — Terminology normalization
     */
    this.normalizeTerminology(resource);

    /**
     * Step 3 — Validation
     */
    // if (config.validate !== false) {
    //   this.validator.validateResource(resource, resourceType);
    // }

    return resource;
  }

  /**
   * Handles common terminology normalization
   */
  private normalizeTerminology(resource: any) {

    /**
     * Patient / Practitioner administrative gender
     */
    if (
      (resource.resourceType === 'Patient' ||
        resource.resourceType === 'Practitioner') &&
      resource.gender
    ) {

      const normalized =
        this.terminology.normalizeCode(
          'http://hl7.org/fhir/administrative-gender',
          resource.gender
        );

      resource.gender = normalized.code;
    }

  }

  /**
   * Aligns user-service / API payloads with mapping field names and derived values.
   */
  private normalizeCanonicalForPatient(
    canonical: Record<string, unknown>
  ): Record<string, unknown> {
    const c: Record<string, unknown> = { ...canonical };

    if (!c.id && c.userID) {
      c.id = c.userID;
    }

    if (!c.firstName && c.givenName) {
      c.firstName = c.givenName;
    }
    if (!c.lastName && c.familyName) {
      c.lastName = c.familyName;
    }

    if (!c.birthDate && c.dateOfBirth) {
      c.birthDate = this.parseDdMmYyyyToIso(String(c.dateOfBirth));
    }

    if (!c.medicalRecordNumber && c.mrn) {
      c.medicalRecordNumber = c.mrn;
    }

    if (c.active === undefined && c.isActive !== undefined) {
      c.active = c.isActive;
    }

    if (!c.organizationId && c.organizationID) {
      c.organizationId = c.organizationID;
    }

    if (c.managingOrganizationReference === undefined && c.organizationId) {
      c.managingOrganizationReference = `Organization/${c.organizationId}`;
    }

    if (!c.email && c.emailAddress) {
      c.email = c.emailAddress;
    }

    const phoneNum = (c.phoneNumber ?? c.phone) as string | undefined;
    if (phoneNum) {
      c.telecomPhoneValue = this.combinePhone(
        String(c.phoneCode ?? ''),
        String(phoneNum)
      );
    }

    const line =
      (c.addressLine ?? c.street ?? c.address) as string | undefined;
    if (line) {
      c.addressLine = line;
    }

    if (!c.postalCode && c.zip) {
      c.postalCode = c.zip;
    }

    if (typeof c.gender === 'string' && c.gender.trim() !== '') {
      const g = c.gender.trim().toLowerCase();
      if (['male', 'female', 'other', 'unknown'].includes(g)) {
        c.gender = g;
      }
    }

    return c;
  }

  private combinePhone(phoneCode: string, phoneNumber: string): string {
    const num = phoneNumber.replace(/\s/g, '');
    const code = phoneCode.trim();
    if (!code) {
      return num;
    }
    if (code.startsWith('+')) {
      return `${code}${num.replace(/^\+/, '')}`;
    }
    return `${code}${num}`;
  }

  /**
   * `DD-MM-YYYY` (and `DD/MM/YYYY`) → FHIR `YYYY-MM-DD`. Returns original string if not matched.
   */
  private parseDdMmYyyyToIso(raw: string): string {
    const m = raw.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) {
      return raw;
    }
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    const y = m[3];
    return `${y}-${mo}-${d}`;
  }

  private pruneIncompletePatientArrays(resource: any): void {
    if (
      resource.resourceType !== 'Patient' &&
      resource.resourceType !== 'Practitioner'
    ) {
      return;
    }
    if (Array.isArray(resource.telecom)) {
      resource.telecom = resource.telecom.filter(
        (t: { value?: string } | undefined) =>
          t != null && t.value != null && String(t.value).trim() !== ''
      );
      if (resource.telecom.length === 0) {
        delete resource.telecom;
      }
    }
    if (Array.isArray(resource.name)) {
      const compactStringArray = (arr: unknown): string[] | undefined => {
        if (!Array.isArray(arr)) {
          return undefined;
        }
        const compacted = arr
          .filter((item) => item != null && String(item).trim() !== '')
          .map((item) => String(item).trim());
        return compacted.length > 0 ? compacted : undefined;
      };

      resource.name = resource.name.filter(
        (n: { family?: string; given?: string[]; prefix?: string[] } | undefined) => {
          if (n == null) {
            return false;
          }
          n.given = compactStringArray(n.given);
          n.prefix = compactStringArray(n.prefix);
          if (typeof n.family === 'string') {
            const family = n.family.trim();
            n.family = family === '' ? undefined : family;
          }
          const hasFamily = n.family != null && String(n.family).trim() !== '';
          const hasGiven =
            Array.isArray(n.given) &&
            n.given.some((g) => g != null && String(g).trim() !== '');
          const hasPrefix =
            Array.isArray(n.prefix) &&
            n.prefix.some((p) => p != null && String(p).trim() !== '');
          return hasFamily || hasGiven || hasPrefix;
        }
      );
      if (resource.name.length === 0) {
        delete resource.name;
      }
    }
    if (Array.isArray(resource.address)) {
      resource.address = resource.address.filter(
        (a: {
          line?: string[];
          city?: string;
          state?: string;
          postalCode?: string;
          country?: string;
        } | undefined) => {
          if (a == null) {
            return false;
          }
          if (Array.isArray(a.line)) {
            a.line = a.line
              .filter((line) => line != null && String(line).trim() !== '')
              .map((line) => String(line).trim());
            if (a.line.length === 0) {
              delete a.line;
            }
          }
          for (const key of ['city', 'state', 'postalCode', 'country'] as const) {
            const value = a[key];
            if (typeof value === 'string') {
              const trimmed = value.trim();
              if (trimmed === '') {
                delete a[key];
              } else {
                a[key] = trimmed;
              }
            }
          }
          const lineSet =
            Array.isArray(a.line) &&
            a.line.some((l) => l != null && String(l).trim() !== '');
          const hasOther = [a.city, a.state, a.postalCode, a.country].some(
            (v) => v != null && String(v).trim() !== ''
          );
          return lineSet || hasOther;
        }
      );
      if (resource.address.length === 0) {
        delete resource.address;
      }
    }
  }

}