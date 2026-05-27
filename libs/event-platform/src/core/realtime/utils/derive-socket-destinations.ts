import type { RealtimeMessage } from '../types/realtime-message.type';
import { buildSocketDestinationKey } from './build-socket-destination-key';
import {
  resolveRealtimeNotifyScope,
  shouldTargetOrg,
  shouldTargetRecipients,
} from './realtime-notify-scope';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function deriveSocketDestinations(message: RealtimeMessage): string[] {
  const destinations = new Set<string>();
  const scope = resolveRealtimeNotifyScope(message.payload);

  if (shouldTargetRecipients(scope)) {
    for (const recipientId of message.recipientIds) {
      const userId = asNonEmptyString(recipientId);
      if (userId) {
        destinations.add(buildSocketDestinationKey({ kind: 'user', userId }));
      }
    }
  }

  if (shouldTargetOrg(scope)) {
    const organizationId = asNonEmptyString(message.payload.organizationId);
    const channel = asNonEmptyString(message.channel);
    if (organizationId && channel) {
      destinations.add(
        buildSocketDestinationKey({
          kind: 'org',
          organizationId,
          channel,
        }),
      );
    }
  }

  const patientId = asNonEmptyString(message.payload.patientId);
  if (patientId) {
    destinations.add(buildSocketDestinationKey({ kind: 'patient', patientId }));
  }

  return [...destinations];
}
