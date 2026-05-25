import type { RealtimeAggregateMessage } from '../types/realtime-aggregate-message.type';
import type { RealtimeMessage } from '../types/realtime-message.type';

export type RealtimeNotifyScope = 'ORG' | 'RECIPIENTS' | 'BOTH';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveRealtimeNotifyScope(
  payload: Record<string, unknown>,
): RealtimeNotifyScope {
  const explicit = payload.realtimeNotifyScope;
  if (explicit === 'ORG' || explicit === 'RECIPIENTS' || explicit === 'BOTH') {
    return explicit;
  }

  const notifyUserIds = payload.notifyUserIds;
  if (
    Array.isArray(notifyUserIds) &&
    notifyUserIds.some((id) => typeof id === 'string' && id.trim())
  ) {
    return 'RECIPIENTS';
  }

  return 'ORG';
}

export function shouldTargetOrg(scope: RealtimeNotifyScope): boolean {
  return scope === 'ORG' || scope === 'BOTH';
}

export function shouldTargetRecipients(scope: RealtimeNotifyScope): boolean {
  return scope === 'RECIPIENTS' || scope === 'BOTH';
}

export function canPublishToOrgDestination(message: RealtimeMessage): boolean {
  const scope = resolveRealtimeNotifyScope(message.payload);
  return (
    shouldTargetOrg(scope) &&
    Boolean(
      asNonEmptyString(message.payload.organizationId) &&
        asNonEmptyString(message.channel),
    )
  );
}

export function canPublishToRecipients(
  message: RealtimeMessage,
  recipientCount: number,
): boolean {
  const scope = resolveRealtimeNotifyScope(message.payload);
  return shouldTargetRecipients(scope) && recipientCount > 0;
}

export function resolveOrganizationIdFromAggregateMessage(
  message: RealtimeAggregateMessage,
): string | undefined {
  const fromRecipient = message.recipients.find((r) =>
    asNonEmptyString(r.organizationId),
  )?.organizationId;

  return (
    asNonEmptyString(fromRecipient) ??
    asNonEmptyString(message.message.payload.organizationId)
  );
}
