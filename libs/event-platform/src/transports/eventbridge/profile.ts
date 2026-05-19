import { parseInboundEvent } from '../../sdk/consumer/parse-inbound-event';
import { normalizeTransportToPayloadCandidate } from '../../sdk/consumer/transport-normalize';
import type { BaseEvent } from '../../typings/base-event.types';
import type { NormalizedTransportEnvelope } from '../../runtime/normalized-transport-envelope';
import type { TransportProfile } from '../../runtime/transport-profile';
import type { ProcessSingleResult } from '../../engine/processor/process-outcomes';
import { mapSingleTransportOutcome } from '../../runtime/transport-outcome-mapper';

function correlationHintFromEventBridge(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const detail = (raw as { detail?: { meta?: { correlationId?: string }; correlationId?: string } })
    .detail;
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const fromMeta = detail.meta?.correlationId;
  if (typeof fromMeta === 'string' && fromMeta.trim().length > 0) {
    return fromMeta.trim();
  }
  const legacy = detail.correlationId;
  if (typeof legacy === 'string' && legacy.trim().length > 0) {
    return legacy.trim();
  }
  return undefined;
}

export const eventBridgeTransportProfile: TransportProfile = {
  transport: 'eventbridge',
  retryModel: 'transport',
  supportsPartialBatch: false,
  defaultTransportMode: 'eventbridge',
  parseInbound(raw: unknown): NormalizedTransportEnvelope {
    return {
      transport: 'eventbridge',
      raw,
      payloadCandidate: normalizeTransportToPayloadCandidate(raw),
      attributes: {
        correlationHint: correlationHintFromEventBridge(raw),
      },
      receivedAt: new Date().toISOString(),
    };
  },
  mapToBaseEvent(envelope: NormalizedTransportEnvelope): BaseEvent<unknown> {
    return parseInboundEvent(envelope.raw);
  },
  buildFailureResponse(outcomes: ProcessSingleResult[]): unknown {
    const first = outcomes[0];
    if (!first) {
      return undefined;
    }
    mapSingleTransportOutcome(first, { supportsPartialBatch: false });
    return undefined;
  },
};
