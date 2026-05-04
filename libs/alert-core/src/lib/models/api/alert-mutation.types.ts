import type { AlertDdbRecord } from '../persistence/alert-ddb.model';
import { AlertWorkflowAction } from '../../constants/alert-workflow-action';

export type WorkflowActionValue = (typeof AlertWorkflowAction)[keyof typeof AlertWorkflowAction];

/** Orchestration input for POST `/alerts/workflow`. */
export interface WorkflowMutationInput {
  alertIds: string[];
  action: WorkflowActionValue;
  /** Primary closure note for RESOLVE / DISMISS; persisted as `closureComment`. */
  closureComment?: string;
  /** Wire `reasonCode` for **RESOLVE** or **DISMISS** (resolve vs dismiss allowlists); mapped to stored fields in service. */
  reasonCode?: string;
  /** Alternative to `closureComment` for the same stored field when clients send `comment` only. */
  comment?: string;
  applyToGroup?: boolean;
  assignToUserId?: string;
  /** Caller id for activity timeline (`performedBy`); defaults to `SYSTEM` if omitted. */
  performedByUserId?: string;
  performedByDisplayName?: string;
}

export interface WorkflowMutationResult {
  succeeded: string[];
  failed: { alertId: string; code: string; message: string }[];
  affectedCount?: number;
  primaryAlert?: AlertDdbRecord;
}
