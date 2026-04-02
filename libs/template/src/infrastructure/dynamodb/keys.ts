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
