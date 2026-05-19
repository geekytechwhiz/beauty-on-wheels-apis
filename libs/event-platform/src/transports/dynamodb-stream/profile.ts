import type { DynamoDBStreamEvent } from 'aws-lambda';

import { buildDynamoStreamPerMessageLoggerContext } from '../../dynamo-stream/dynamo-stream-per-message-context';
import type { ProcessSingleResult } from '../../engine/processor/process-outcomes';
import { isAckedWithoutBatchFailure } from '../../engine/processor/process-outcomes';
import { normalizeTransportToPayloadCandidate } from '../../sdk/consumer/transport-normalize';
import type { BaseEvent } from '../../typings/base-event.types';
import type { NormalizedTransportEnvelope } from '../../runtime/normalized-transport-envelope';
import type { TransportProfile } from '../../runtime/transport-profile';

export type DynamoStreamMapRawToBaseEvent = (raw: unknown) => BaseEvent<unknown>;

export function createDynamoStreamTransportProfile(
  mapRawToBaseEvent: DynamoStreamMapRawToBaseEvent,
): TransportProfile {
  return {
    transport: 'dynamodb-stream',
    retryModel: 'transport',
    supportsPartialBatch: true,
    defaultTransportMode: 'dynamodb-stream',
    parseInbound(raw: unknown): NormalizedTransportEnvelope {
      const record = raw as {
        eventID?: string;
        eventSourceARN?: string;
        dynamodb?: { SequenceNumber?: string };
      };
      return {
        transport: 'dynamodb-stream',
        raw,
        payloadCandidate: normalizeTransportToPayloadCandidate(raw),
        attributes: {
          messageId: record.eventID,
          eventSourceArn: record.eventSourceARN,
          sequenceNumber: record.dynamodb?.SequenceNumber,
        },
        receivedAt: new Date().toISOString(),
      };
    },
    mapToBaseEvent(): BaseEvent<unknown> {
      throw new Error('DynamoDB stream profile requires mapRawToBaseEvent override');
    },
    buildFailureResponse(outcomes: ProcessSingleResult[]): unknown {
      const failed = outcomes.filter((outcome) => !isAckedWithoutBatchFailure(outcome.outcome));
      if (failed.length === 0) {
        return { batchItemFailures: [] };
      }
      return {
        batchItemFailures: failed.map((_, index) => ({
          itemIdentifier: `unknown-${index}`,
        })),
      };
    },
    perRecordLoggerContext(envelope, operation, lambdaAwsRequestId) {
      return buildDynamoStreamPerMessageLoggerContext({
        rawRecord: envelope.raw,
        operation,
        lambdaAwsRequestId,
      });
    },
  };
}

export function coerceDynamoStreamBatchResponse(
  event: DynamoDBStreamEvent,
  result: unknown,
): { batchItemFailures: { itemIdentifier: string }[] } {
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as { batchItemFailures: unknown[] }).batchItemFailures)
  ) {
    return result as { batchItemFailures: { itemIdentifier: string }[] };
  }

  const single = result as ProcessSingleResult | undefined;
  if (!single || typeof single !== 'object' || !('outcome' in single)) {
    return { batchItemFailures: [] };
  }

  const itemIdentifier = event.Records?.[0]?.eventID ?? 'unknown';
  if (isAckedWithoutBatchFailure(single.outcome)) {
    return { batchItemFailures: [] };
  }

  return { batchItemFailures: [{ itemIdentifier }] };
}
