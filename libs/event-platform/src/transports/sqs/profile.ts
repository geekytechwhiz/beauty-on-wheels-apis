import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

import {
  approximateReceiveCountFromSqsRecord,
  buildSqsPerMessageLoggerContext,
  correlationHintFromSqsRecord,
  getSqsRecordShape,
  sqsRecordFifoMetadata,
} from '../../lib/sqs-per-message-context';
import { parseInboundEvent } from '../../sdk/consumer/parse-inbound-event';
import { normalizeTransportToPayloadCandidate } from '../../sdk/consumer/transport-normalize';
import type { BaseEvent } from '../../typings/base-event.types';
import {
  coerceConsumeResultToSqsBatchResponse,
} from '../../runtime/transport-outcome-mapper';
import type { NormalizedTransportEnvelope } from '../../runtime/normalized-transport-envelope';
import type { TransportProfile } from '../../runtime/transport-profile';
import type { ProcessSingleResult } from '../../engine/processor/process-outcomes';
import { isAckedWithoutBatchFailure } from '../../engine/processor/process-outcomes';

export const sqsTransportProfile: TransportProfile = {
  transport: 'sqs',
  retryModel: 'transport',
  supportsPartialBatch: true,
  defaultTransportMode: 'sqs-native',
  parseInbound(raw: unknown): NormalizedTransportEnvelope {
    const record = getSqsRecordShape(raw);
    const fifo = sqsRecordFifoMetadata(raw);
    return {
      transport: 'sqs',
      raw,
      payloadCandidate: normalizeTransportToPayloadCandidate(raw),
      attributes: {
        messageId: record?.messageId,
        receiptHandle: record?.receiptHandle,
        approximateReceiveCount: approximateReceiveCountFromSqsRecord(raw),
        fifoGroupId: fifo.fifoMessageGroupId,
        fifoDeduplicationId: fifo.fifoMessageDeduplicationId,
        eventSourceArn: record?.eventSourceARN,
        correlationHint: correlationHintFromSqsRecord(raw),
      },
      receivedAt: new Date().toISOString(),
    };
  },
  mapToBaseEvent(envelope: NormalizedTransportEnvelope): BaseEvent<unknown> {
    return parseInboundEvent(envelope.raw);
  },
  buildFailureResponse(outcomes: ProcessSingleResult[]): unknown {
    const failed = outcomes.filter((outcome) => !isAckedWithoutBatchFailure(outcome.outcome));
    if (failed.length === 0) {
      return { batchItemFailures: [] } satisfies SQSBatchResponse;
    }
    return {
      batchItemFailures: failed.map((_, index) => ({
        itemIdentifier: `unknown-${index}`,
      })),
    } satisfies SQSBatchResponse;
  },
  perRecordLoggerContext(envelope, operation, lambdaAwsRequestId) {
    return buildSqsPerMessageLoggerContext({
      rawRecord: envelope.raw,
      operation,
      lambdaAwsRequestId,
    });
  },
};

export function buildSqsBatchResponseFromConsumeResult(
  event: SQSEvent,
  result: unknown,
): SQSBatchResponse {
  return coerceConsumeResultToSqsBatchResponse(event, result);
}
