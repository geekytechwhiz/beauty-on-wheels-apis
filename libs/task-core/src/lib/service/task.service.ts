import type { Logger } from '@api-hub/observability';

import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateMonitoringActionPayload } from '../models/api/create-monitoring-action.types';
import type { CreateRuntimeTaskPayload } from '../models/api/create-runtime-task.types';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { IDEMPOTENCY_OUTCOME, type IdempotencyOutcome } from '../models/types/task-domain.types';
import { TaskRepository } from '../repositories/task-repository';

import { BaseTaskService } from './base-task.service';

export type TaskRecord = TaskMetaDdbRecord;

export type CreateMonitoringActionResult = {
  record: TaskMetaDdbRecord;
  outcome: IdempotencyOutcome;
};

export type CreateRuntimeTaskResult = {
  record: TaskMetaDdbRecord;
};

export class TaskService extends BaseTaskService {
  constructor(repo?: TaskRepository, log?: Logger) {
    super(repo, log);
  }

  async createMonitoringAction(
    payload: CreateMonitoringActionPayload,
  ): Promise<CreateMonitoringActionResult> {
    const input = { ...payload };
    const { runtimeTaskInstanceId } = this.repo.buildMonitoringKeys(input);

    const resolution = await this.repo.resolveMonitoringNaturalKey(
      runtimeTaskInstanceId,
      input.organizationId,
    );

    if (resolution === 'foreign_org') {
      const e = new Error('This idempotency key is already in use') as Error & {
        statusCode: number;
        code: string;
      };
      e.statusCode = 409;
      e.code = 'IDEMPOTENCY_KEY_IN_USE';
      throw e;
    }

    if (resolution !== 'missing') {
      this.log.info({
        event: 'task_monitoring_idempotent_replay',
        message: 'Idempotent replay for monitoring natural key',
        runtimeTaskInstanceId,
        organizationId: input.organizationId,
      });
      return { record: resolution, outcome: IDEMPOTENCY_OUTCOME.SKIPPED_DUPLICATE };
    }

    try {
      const record = await this.repo.createMonitoringTask(input);
      return { record, outcome: IDEMPOTENCY_OUTCOME.CREATED };
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (name === 'TransactionCanceledException' || e instanceof DuplicateTaskError) {
        const again = await this.repo.resolveMonitoringNaturalKey(
          runtimeTaskInstanceId,
          input.organizationId,
        );
        if (again !== 'missing' && again !== 'foreign_org') {
          this.log.warn({
            event: 'task_monitoring_idempotent_after_transaction_race',
            message: 'Resolved duplicate after TransactionCanceledException',
            runtimeTaskInstanceId,
            organizationId: input.organizationId,
          });
          return { record: again, outcome: IDEMPOTENCY_OUTCOME.SKIPPED_DUPLICATE };
        }
      }
      throw e;
    }
  }

  async createRuntimeTask(payload: CreateRuntimeTaskPayload): Promise<CreateRuntimeTaskResult> {
    const record = await this.repo.createRuntimeTask(payload);
    return { record };
  }
}
