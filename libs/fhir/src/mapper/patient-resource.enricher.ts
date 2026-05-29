import type { ResourceMappingConfig } from '../registry/mapping.registry';

type AnyObject = Record<string, unknown>;

const PATIENT_CONTACT_RELATIONSHIP_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v2-0131';

const FAMILY_RELATION_ALIASES = new Set([
  'father',
  'mother',
  'parent',
  'guardian',
  'spouse',
  'husband',
  'wife',
  'brother',
  'sister',
  'sibling',
  'son',
  'daughter',
  'child',
  'grandparent',
  'grandmother',
  'grandfather',
  'aunt',
  'uncle',
  'cousin',
  'niece',
  'nephew',
  'next-of-kin',
  'nextofkin',
  'kin',
  'family',
]);

function resolvePatientContactRelationship(relation: string): {
  coding: Array<{ system: string; code: string; display: string }>;
  text?: string;
} {
  const normalized = relation.toLowerCase().trim();

  if (normalized === '') {
    return {
      coding: [
        {
          system: PATIENT_CONTACT_RELATIONSHIP_SYSTEM,
          code: 'C',
          display: 'Emergency Contact',
        },
      ],
    };
  }

  if (normalized === 'employer') {
    return {
      coding: [
        {
          system: PATIENT_CONTACT_RELATIONSHIP_SYSTEM,
          code: 'E',
          display: 'Employer',
        },
      ],
      text: relation,
    };
  }

  if (normalized === 'insurance' || normalized === 'insurance company') {
    return {
      coding: [
        {
          system: PATIENT_CONTACT_RELATIONSHIP_SYSTEM,
          code: 'I',
          display: 'Insurance Company',
        },
      ],
      text: relation,
    };
  }

  if (FAMILY_RELATION_ALIASES.has(normalized)) {
    return {
      coding: [
        {
          system: PATIENT_CONTACT_RELATIONSHIP_SYSTEM,
          code: 'N',
          display: 'Next-of-Kin',
        },
      ],
      text: relation,
    };
  }

  return {
    coding: [
      {
        system: PATIENT_CONTACT_RELATIONSHIP_SYSTEM,
        code: 'C',
        display: 'Emergency Contact',
      },
    ],
    text: relation,
  };
}

function asProfileArray(profile: ResourceMappingConfig['profile']): string[] {
  if (!profile) {
    return [];
  }

  return Array.isArray(profile) ? profile : [profile];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolvePatientDisplayName(resource: AnyObject): string | undefined {
  const names = resource.name;
  if (!Array.isArray(names) || names.length === 0) {
    return undefined;
  }

  const name = names[0] as Record<string, unknown>;
  if (typeof name.text === 'string' && name.text.trim() !== '') {
    return name.text.trim();
  }

  const given = Array.isArray(name.given)
    ? name.given.map(String).filter(Boolean).join(' ')
    : '';
  const family = typeof name.family === 'string' ? name.family : '';
  const combined = [given, family].filter(Boolean).join(' ').trim();

  return combined || undefined;
}

function appendIdentifier(
  resource: AnyObject,
  identifier: Record<string, unknown>,
): void {
  const existing = Array.isArray(resource.identifier)
    ? (resource.identifier as Record<string, unknown>[])
    : [];

  resource.identifier = [...existing, identifier];
}

function applyMrnIdentifier(resource: AnyObject, mrn: unknown): void {
  const value = typeof mrn === 'string' ? mrn.trim() : '';
  if (value === '') {
    return;
  }

  appendIdentifier(resource, {
    type: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
          code: 'MR',
        },
      ],
    },
    system: 'https://myvirtualrx.com/fhir/mrn',
    value,
  });
}

function applyInsuranceIdentifier(
  resource: AnyObject,
  insuranceDetails: unknown,
): void {
  if (insuranceDetails == null || typeof insuranceDetails !== 'object') {
    return;
  }

  const details = insuranceDetails as Record<string, unknown>;
  const policyNumber =
    typeof details.policyNumber === 'string'
      ? details.policyNumber.trim()
      : '';

  if (policyNumber === '') {
    return;
  }

  appendIdentifier(resource, {
    type: { text: 'Insurance Policy' },
    system: 'https://myvirtualrx.com/fhir/insurance',
    value: policyNumber,
  });
}

function applyEmergencyContact(
  resource: AnyObject,
  emergencyContact: unknown,
): void {
  if (emergencyContact == null || typeof emergencyContact !== 'object') {
    return;
  }

  const contact = emergencyContact as Record<string, unknown>;
  const name = typeof contact.name === 'string' ? contact.name.trim() : '';
  const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  const relation =
    typeof contact.relation === 'string' ? contact.relation.trim() : '';

  if (name === '' && phone === '') {
    return;
  }

  const relationship = resolvePatientContactRelationship(relation);

  resource.contact = [
    {
      relationship: [relationship],
      ...(name !== '' ? { name: { text: name } } : {}),
      ...(phone !== '' ? { telecom: [{ system: 'phone', value: phone }] } : {}),
    },
  ];
}

function formatMedicalHistoryLines(medicalHistory: unknown): string[] {
  if (medicalHistory == null || typeof medicalHistory !== 'object') {
    return [];
  }

  const history = medicalHistory as Record<string, unknown>;
  const lines: string[] = [];

  for (const [label, key] of [
    ['Allergies', 'allergies'],
    ['Symptoms', 'symptoms'],
    ['Chronic diseases', 'chronicDiseases'],
  ] as const) {
    const values = history[key];
    if (Array.isArray(values) && values.length > 0) {
      lines.push(
        `<li>${label}: ${escapeHtml(values.map(String).join(', '))}</li>`,
      );
    }
  }

  return lines;
}

function buildPatientNarrative(
  resource: AnyObject,
  canonical: AnyObject,
): { status: 'generated'; div: string } {
  const displayName = resolvePatientDisplayName(resource) ?? 'Patient';
  const sections: string[] = [`<p>${escapeHtml(displayName)}</p>`];

  const medicalHistoryLines = formatMedicalHistoryLines(
    canonical.medicalHistory,
  );
  if (medicalHistoryLines.length > 0) {
    sections.push(`<ul>${medicalHistoryLines.join('')}</ul>`);
  }

  const insuranceDetails = canonical.insuranceDetails;
  if (insuranceDetails != null && typeof insuranceDetails === 'object') {
    const details = insuranceDetails as Record<string, unknown>;
    const provider =
      typeof details.provider === 'string' ? details.provider.trim() : '';
    if (provider !== '') {
      sections.push(`<p>Insurance provider: ${escapeHtml(provider)}</p>`);
    }
  }

  return {
    status: 'generated',
    div: `<div xmlns="http://www.w3.org/1999/xhtml">${sections.join('')}</div>`,
  };
}

/**
 * Maps canonical patient-only fields to standard FHIR R4 elements so resources
 * validate without a custom implementation guide.
 */
export function enrichPatientResource(
  resource: AnyObject,
  canonical: AnyObject,
  mapping: ResourceMappingConfig,
): void {
  applyMrnIdentifier(resource, canonical.mrn);
  applyInsuranceIdentifier(resource, canonical.insuranceDetails);
  applyEmergencyContact(resource, canonical.emergencyContact);

  resource.text = buildPatientNarrative(resource, canonical);

  const profiles = asProfileArray(mapping.profile);
  if (profiles.length > 0) {
    resource.meta = { profile: profiles };
  }
}
