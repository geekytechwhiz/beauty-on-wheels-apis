import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';

export type AlertRealtimeNotifyScope = 'ORG' | 'RECIPIENTS' | 'BOTH';

export function resolveAlertRealtimeNotifyScope(
  payload: AlertCreateIngestPayload,
): AlertRealtimeNotifyScope {
  if (payload.realtimeNotifyScope) {
    return payload.realtimeNotifyScope;
  }

  if (payload.notifyUserIds?.some((id) => id.trim())) {
    return 'RECIPIENTS';
  }

  return 'ORG';
}

export function shouldResolveAlertRecipients(scope: AlertRealtimeNotifyScope): boolean {
  return scope === 'RECIPIENTS' || scope === 'BOTH';
}
