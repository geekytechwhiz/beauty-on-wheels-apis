import {
  buildEventBridgePerMessageLoggerContext,
  correlationHintFromEventBridge,
} from '../../lib/event-bridge-per-message-context';
import { parseInboundEvent } from '../../sdk/consumer/parse-inbound-event';
import { normalizeTransportToPayloadCandidate } from '../../sdk/consumer/transport-normalize';
import type { BaseEvent } from '../../typings/base-event.types';
import type { NormalizedTransportEnvelope } from '../../runtime/normalized-transport-envelope';
import type { TransportProfile } from '../../runtime/transport-profile';
import type { ProcessSingleResult } from '../../engine/processor/process-outcomes';
import { mapSingleTransportOutcome } from '../../runtime/transport-outcome-mapper';

export { correlationHintFromEventBridge };

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
  perRecordLoggerContext(envelope, operation, lambdaAwsRequestId) {
    return buildEventBridgePerMessageLoggerContext({
      rawRecord: envelope.raw,
      operation,
      lambdaAwsRequestId,
    });
  },
};
