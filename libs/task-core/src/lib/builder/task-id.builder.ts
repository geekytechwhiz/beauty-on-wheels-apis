import { randomUUID } from 'crypto';

import { sha256Hex } from '@api-hub/utils';

import { TASK_BUSINESS_ID_PREFIX, TASK_DDB_KEY_PREFIX } from '../constants/task-key.constants';

export class TaskIdBuilder {
  static newRuntimeTaskInstanceId(): string {
    return `${TASK_BUSINESS_ID_PREFIX.RUNTIME_TASK}${randomUUID()}`;
  }

  static deterministicRuntimeTaskInstanceId(idempotencyKey: string): string {
    const hash = sha256Hex(idempotencyKey);
    return `${TASK_BUSINESS_ID_PREFIX.RUNTIME_TASK}${hash.slice(0, 32)}`;
  }

  static buildReminderRecordId(
    runtimeTaskInstanceId: string,
    scheduledAt: number,
    channel: string,
  ): string {
    const sanitizedChannel = channel.replace(/[^0-9a-zA-Z-_.]/g, '-');
    return `${TASK_BUSINESS_ID_PREFIX.REMINDER_RECORD}${runtimeTaskInstanceId}-${scheduledAt}-${sanitizedChannel}`;
  }

  static newCompletionEvidenceId(): string {
    return `${TASK_BUSINESS_ID_PREFIX.COMPLETION_EVIDENCE}${randomUUID()}`;
  }

  static buildEvidenceSummaryId(runtimeTaskInstanceId: string): string {
    return `${TASK_BUSINESS_ID_PREFIX.EVIDENCE_SUMMARY}${runtimeTaskInstanceId}-latest`;
  }

  static buildCompletionEvidenceSk(completionEvidenceId: string): string {
    return `${TASK_DDB_KEY_PREFIX.EVID}${completionEvidenceId}`;
  }
}
