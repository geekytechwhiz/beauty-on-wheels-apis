/**
 * SQS transport configuration. DLQ URL is informational until DLQ routing is enforced in a later step.
 */
export type SqsAdapterConfig = {
  queueUrl: string;
  region: string;
  /** Set when this queue is associated with a dead-letter queue (not used by the adapter yet). */
  deadLetterQueueUrl?: string;
};
