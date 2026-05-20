import type { LoggerContext } from '@api-hub/observability';

import type { TransportMode } from '../core/policy/delivery-policy';
import type { ProcessSingleResult } from '../engine/processor/process-outcomes';
import type { BaseEvent } from '../typings/base-event.types';
import type { NormalizedTransportEnvelope } from './normalized-transport-envelope';

export interface TransportProfile {
  transport: NormalizedTransportEnvelope['transport'];
  parseInbound(raw: unknown): NormalizedTransportEnvelope;
  mapToBaseEvent(envelope: NormalizedTransportEnvelope): BaseEvent<unknown>;
  buildFailureResponse(outcomes: ProcessSingleResult[]): unknown;
  supportsPartialBatch: boolean;
  retryModel: 'transport' | 'application' | 'hybrid';
  defaultTransportMode: TransportMode;
  perRecordLoggerContext?(
    envelope: NormalizedTransportEnvelope,
    operation: string,
    lambdaAwsRequestId?: string,
  ): LoggerContext;
}
