import patientR4 from '../mappings/R4/Patient.mapping.json';

import organizationR4 from '../mappings/R4/Organization.mapping.json';

import observationR4 from '../mappings/R4/Observation.mapping.json';

import practitionerR4 from '../mappings/R4/Practitioner.mapping.json';

import relatedPersonR4 from '../mappings/R4/RelatedPerson.mapping.json';

export interface MappingField {
  source: string;
  target: string;
  fieldType: string;
  required?: boolean;
  template?: string;
  system?: string;
  defaultValue?: unknown;
  transform?: string;
}

export type ExtensionValueType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'date'
  | 'code'
  | 'json';

export interface ExtensionMapping {
  source: string;
  url: string;
  valueType: ExtensionValueType;
}

export interface ResourceMappingConfig {
  resource: string;
  version: string;
  profile?: string;
  fields: MappingField[];
  extensions?: ExtensionMapping[];
}

export const defaultMappingRegistry = {
  Patient: {
    R4: patientR4,
  },

  Organization: {
    R4: organizationR4,
  },

  Observation: {
    R4: observationR4,
  },

  Practitioner: {
    R4: practitionerR4,
  },

  RelatedPerson: {
    R4: relatedPersonR4,
  },
};

/**
 * Client-specific mapping overrides.
 *
 * Register overrides under mappings/clients/{clientId}/{version}/, then import
 * and add entries here keyed by clientId → resource → version.
 */
export const clientMappingRegistry: Record<
  string,
  Record<string, Record<string, ResourceMappingConfig>>
> = {};
