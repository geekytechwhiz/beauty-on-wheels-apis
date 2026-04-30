import { DlqMessage } from "../../typings/dlq.types";

/**
 * Dead-letter awareness for application code. Actual queue routing is done by
 * SQS redrive policies / EventBridge — this flag only controls structured outcomes.
 */
export type DlqConfig = {
  enabled: boolean; 
  strategy?: DlqStrategy; 
  enrich?: (params: {
    event: unknown;
    error: unknown;
    retryCount?: number;
  }) => Partial<DlqMessage>;
};

export interface DlqStrategy {
  send(
    message: DlqMessage
  ): Promise<void>;
}