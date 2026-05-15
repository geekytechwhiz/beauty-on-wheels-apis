import type { TransportProfile } from './transport-profile';
import type { NormalizedTransportEnvelope } from './normalized-transport-envelope';
import { processSingle } from '../engine/processor/process-single';
import type { EventConsumerDeps } from '../typings/consumer.types';

export async function runFixtureThroughProfile(
  profile: TransportProfile,
  raw: unknown,
  deps: EventConsumerDeps,
  registry: Record<string, (event: import('../typings/base-event.types').BaseEvent<unknown>) => Promise<void>>,
) {
  const mergedDeps: EventConsumerDeps = {
    ...deps,
    transportProfile: profile,
    transportMode: deps.transportMode ?? profile.defaultTransportMode,
    mapRawToBaseEvent:
      deps.mapRawToBaseEvent ??
      ((record: unknown) => profile.mapToBaseEvent(profile.parseInbound(record))),
  };

  return processSingle({
    raw,
    deps: mergedDeps,
    registry,
  });
}

export function readEnvelope(profile: TransportProfile, raw: unknown): NormalizedTransportEnvelope {
  return profile.parseInbound(raw);
}
