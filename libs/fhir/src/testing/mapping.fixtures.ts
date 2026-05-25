import type { ResourceMappingConfig } from '../registry/mapping.registry';

import patientR4Mapping from '../mappings/R4/Patient.mapping.json';

export const canonicalPatient = {
  organizationID: 'org-123',
  userInfo: {
    name: 'Jane Doe',
    namePrefix: 'Dr',
    gender: 'Female',
    dateOfBirth: '1990-01-15',
    contact: {
      email: 'jane@example.com',
      phone: '555-0100',
    },
  },
};

export const flatCanonicalPatient = {
  userID: '01KQMPG288ANNZ9FAMMC1WZEH3',
  patientId: '01KQMPG288ANNZ9FAMMC1WZEH3',
  organizationID: 'mm3208au877eaa2d',
  fullName: 'Patient Jasir Hassan',
  firstName: 'Patient',
  lastName: 'Jasir Hassan',
  namePrefix: 'Mr',
  phoneNumber: '9995123094',
  emailAddress: 'pat.jasir.has@yopmail.com',
  gender: 'Male',
  dateOfBirth: '12-07-1997',
  mrn: 'PI-MOOIY7IR307713',
  medicalHistory: {
    allergies: ['Food Allergy', 'Pet Allergy'],
    symptoms: [],
    chronicDiseases: ['Asthma'],
  },
  insuranceDetails: {},
  emergencyContact: {
    name: 'Father Jasir',
    phone: '9809123456',
    relation: 'father',
  },
  isLoggedIn: false,
  roleName: 'PATIENT',
  pk: 'ORG#mm3208au877eaa2d',
  sk: 'USER#01KQMPG288ANNZ9FAMMC1WZEH3',
};

export const patientMappingFixture: ResourceMappingConfig = {
  resource: 'Patient',
  version: 'R4',
  profile: 'http://hl7.org/fhir/StructureDefinition/Patient',
  fields: [
    {
      source: 'organizationID',
      target: 'id',
      fieldType: 'string',
    },
    {
      source: 'userInfo.namePrefix',
      target: 'name.0.prefix.0',
      fieldType: 'string',
    },
    {
      source: 'userInfo.name',
      target: 'name.0.text',
      fieldType: 'string',
    },
    {
      source: 'userInfo.contact.phone',
      target: 'telecom.0.value',
      fieldType: 'string',
    },
    {
      source: '',
      target: 'telecom.0.system',
      fieldType: 'literal',
      defaultValue: 'phone',
    },
    {
      source: 'userInfo.contact.email',
      target: 'telecom.1.value',
      fieldType: 'string',
    },
    {
      source: '',
      target: 'telecom.1.system',
      fieldType: 'literal',
      defaultValue: 'email',
    },
    {
      source: 'userInfo.gender',
      target: 'gender',
      fieldType: 'code',
      system: 'http://hl7.org/fhir/administrative-gender',
    },
    {
      source: 'userInfo.dateOfBirth',
      target: 'birthDate',
      fieldType: 'date',
    },
    {
      source: 'organizationID',
      target: 'managingOrganization.reference',
      fieldType: 'reference',
      template: 'Organization/{{value}}',
    },
  ],
};

export const clientPatientOverrideFixture: ResourceMappingConfig = {
  resource: 'Patient',
  version: 'R4',
  fields: [
    {
      source: 'externalPatientId',
      target: 'id',
      fieldType: 'string',
    },
  ],
};

export const minimalObservationMappingFixture: ResourceMappingConfig = {
  resource: 'Observation',
  version: 'R4',
  fields: [
    {
      source: 'observationId',
      target: 'id',
      fieldType: 'string',
    },
    {
      source: 'status',
      target: 'status',
      fieldType: 'code',
    },
    {
      source: 'code',
      target: 'code.text',
      fieldType: 'string',
    },
  ],
};

export const fhirPatientFromFixture = {
  resourceType: 'Patient',
  id: 'org-123',
  name: [{ prefix: ['Dr'], text: 'Jane Doe' }],
  telecom: [
    { system: 'phone', value: '555-0100' },
    { system: 'email', value: 'jane@example.com' },
  ],
  gender: 'female',
  birthDate: '1990-01-15',
  managingOrganization: { reference: 'Organization/org-123' },
};

export const patientR4MappingFixture =
  patientR4Mapping as ResourceMappingConfig;
