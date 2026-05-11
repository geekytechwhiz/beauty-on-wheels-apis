import type { EventConsumerDeps } from '../typings/consumer.types';

/**
 * Recommended **maxReceiveCount** for an SQS main queue redrive policy toward a DLQ.
 *
 * Each consumer delivery increments `ApproximateReceiveCount`; the platform's
 * {@link resolveDeliveryPolicy} / {@link evaluateDeliveryPolicy} compares that count
 * (via {@link computeEffectiveDeliveryAttempt}) to `retry.maxAttempts`.
 *
 * Set SQS **maxReceiveCount** to at least this value so messages are not sent to the
 * AWS DLQ before application retry policy can exhaust attempts. Operators may add a
 * small buffer (+1) for edge cases.
 *
 * @see https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html
 */
export function recommendedSqsRedriveMaxReceiveCount(
  consumer: Pick<EventConsumerDeps, 'retry'>,
): number {
  return Math.max(1, consumer.retry.maxAttempts);
}
