/**
 * Dead-letter awareness for application code. Actual queue routing is done by
 * SQS redrive policies / EventBridge — this flag only controls structured outcomes.
 */
export type DlqConfig = {
  /** When true, consumers may return a dead-letter candidate result after retries exhaust. */
  enabled: boolean;
};
