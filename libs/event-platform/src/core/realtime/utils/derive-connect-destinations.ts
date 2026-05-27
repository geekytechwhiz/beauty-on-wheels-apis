import { buildSocketDestinationKey } from './build-socket-destination-key';

export type WebSocketConnectContext = {
  userId?: string;
  organizationId?: string;
  channels?: string[];
  extraDestinations?: string[];
};

/**
 * Builds destination keys stored on $connect for later {@link ConnectionResolver} lookups.
 */
export function deriveConnectDestinations(context: WebSocketConnectContext): string[] {
  const destinations = new Set<string>();

  for (const dest of context.extraDestinations ?? []) {
    const trimmed = dest.trim();
    if (trimmed) {
      destinations.add(trimmed);
    }
  }

  const userId = context.userId?.trim();
  if (userId) {
    destinations.add(buildSocketDestinationKey({ kind: 'user', userId }));
  }

  const organizationId = context.organizationId?.trim();
  for (const channel of context.channels ?? []) {
    const trimmedChannel = channel.trim();
    if (organizationId && trimmedChannel) {
      destinations.add(
        buildSocketDestinationKey({
          kind: 'org',
          organizationId,
          channel: trimmedChannel,
        }),
      );
    }
  }

  return [...destinations];
}

export function parseCommaSeparatedList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
