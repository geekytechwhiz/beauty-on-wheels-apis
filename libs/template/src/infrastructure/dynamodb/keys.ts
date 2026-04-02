export function orgPk(orgId: string): string {
  return `ORG#${orgId}`;
}

export function templateVersionSk(templateId: string, version: string): string {
  return `TEMPLATE#${templateId}#VERSION#${version}`;
}

export function gsi1Pk(orgId: string, templateId: string): string {
  return `ORG#${orgId}#TEMPLATE#${templateId}`;
}

export function gsi1Sk(version: string): string {
  return `VERSION#${version}`;
}

/** One published template slot per org profile (profileKey includes org). */
export function gsi3Pk(profileKey: string): string {
  return `PROFILE#${profileKey}`;
}

export function gsi3SkPublished(templateId: string, version: string): string {
  return `PUBLISHED#${templateId}#${version}`;
}

export const ENTITY_TYPE = 'TEMPLATE' as const;
export const METADATA_ENTITY_TYPE = 'METADATA' as const;
export const OUTBOX_ENTITY_TYPE = 'OUTBOX' as const;
export const RUNTIME_BINDING_ENTITY_TYPE = 'RUNTIME_BINDING' as const;
export const IDEMPOTENCY_ENTITY_TYPE = 'IDEMPOTENCY' as const;

export function outboxPk(eventId: string): string {
  return `EVENT#${eventId}`;
}

export function outboxSk(): string {
  return 'OUTBOX';
}

export function outboxStatusPk(status: 'PENDING' | 'SENT'): string {
  return `OUTBOX#${status}`;
}

export function outboxStatusSk(timestamp: string, eventId: string): string {
  return `${timestamp}#${eventId}`;
}

export function runtimeBindingPk(patientId: string): string {
  return `PATIENT#${patientId}`;
}

export function runtimeBindingSk(templateId: string): string {
  return `TEMPLATE#${templateId}`;
}

export function idempotencyPk(idempotencyKey: string): string {
  return `IDEMPOTENCY#${idempotencyKey}`;
}

export function idempotencySk(): string {
  return 'RESULT';
}

/** pk = METADATA#&lt;type&gt; e.g. METADATA#FIELD */
export function metadataPk(metadataType: string): string {
  return `METADATA#${metadataType}`;
}

/** sk = METADATA#&lt;name&gt;#&lt;version&gt; e.g. METADATA#ReviewCadence#v1 */
export function metadataSk(name: string, version: string): string {
  return `METADATA#${name}#${version}`;
}

/** Types queried in parallel for getApplicableMetadata (extend as new partitions are added). */
export const METADATA_REGISTRY_TYPES = ['FIELD', 'SECTION'] as const;
export type MetadataRegistryType = (typeof METADATA_REGISTRY_TYPES)[number];
