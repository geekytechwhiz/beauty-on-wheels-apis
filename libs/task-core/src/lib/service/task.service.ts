import type { Logger } from '@api-hub/observability';

import { TaskEntityBuilder } from '../builder/task-entity.builder';
import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateMonitoringActionPayload } from '../models/api/create-monitoring-action.types';
import type { CreateRuntimeTaskPayload } from '../models/api/create-runtime-task.types';
import type {
  CreateCarePlanTaskRequest,
  GenerateCarePlanTasksRequest,
  GenerateCarePlanTasksResult,
} from '../models/api/generate-care-plan.request';
import type {
  UpdateAssignedStaffRequest,
  UpdateAssignedStaffResult,
} from '../models/api/update-assigned-staff.request';
import { ASSIGNED_TO_TYPE } from '../models/types/task-domain.types';
import type {
  CompletionEvidenceDdbRecord,
  TaskEvidenceSummaryDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import { IDEMPOTENCY_OUTCOME, type IdempotencyOutcome } from '../models/types/task-domain.types';
import { toRuntimeTaskCard, toTaskHistoryEntry } from '../mappers/task-http.dto';
import { TaskRepository } from '../repositories/task-repository';
import { organizationIdsMatch } from '../utils/organization-ids-match';
import { decodeTaskHistoryCursor, encodeTaskHistoryCursor } from '../utils/task.utils';

import { BaseTaskService } from './base-task.service';

export type TaskRecord = TaskMetaDdbRecord;

export type CreateMonitoringActionResult = {
  record: TaskMetaDdbRecord;
  outcome: IdempotencyOutcome;
};

export type CreateRuntimeTaskResult = {
  record: TaskMetaDdbRecord;
};

export type GetRuntimeTaskDetailInput = {
  organizationId: string;
  runtimeTaskInstanceId: string;
  includeRelated?: boolean;
};

export type RuntimeTaskDetail = {
  task: ReturnType<typeof toRuntimeTaskCard>;
  reminders?: unknown[];
  completionEvidence?: CompletionEvidenceDdbRecord[];
  evidenceSummary?: TaskEvidenceSummaryDdbRecord;
};

export type GetRuntimeTaskHistoryInput = {
  organizationId: string;
  runtimeTaskInstanceId: string;
  pageSize: number;
  nextToken?: string;
};

export type PaginatedTaskHistory = {
  items: ReturnType<typeof toTaskHistoryEntry>[];
  nextToken?: string;
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

  async getRuntimeTaskDetail(input: GetRuntimeTaskDetailInput): Promise<RuntimeTaskDetail> {
    const lookup = await this.repo.getLookupByTaskId(input.runtimeTaskInstanceId);
    if (!lookup) {
      throw taskHttpError('Runtime task not found', 404, 'TASK_NOT_FOUND');
    }

    if (!organizationIdsMatch(lookup.orgId, input.organizationId)) {
      throw taskHttpError('Runtime task does not belong to this organization', 403, 'FORBIDDEN');
    }

    const record = await this.repo.getMetaByLookup(lookup);
    if (!record) {
      throw taskHttpError('Runtime task not found', 404, 'TASK_NOT_FOUND');
    }

    const detail: RuntimeTaskDetail = {
      task: toRuntimeTaskCard(record),
    };

    if (input.includeRelated !== false) {
      detail.reminders = lookup.reminderHistory ?? [];
      if (lookup.evidenceSummary) {
        detail.evidenceSummary = lookup.evidenceSummary;
      }
      detail.completionEvidence = await this.repo.queryCompletionEvidence(input.runtimeTaskInstanceId);
    }

    return detail;
  }

  async reassignAssignedStaff(input: UpdateAssignedStaffRequest): Promise<UpdateAssignedStaffResult> {
    const lookup = await this.repo.getLookupByTaskId(input.runtimeTaskInstanceId);
    if (!lookup) {
      throw taskHttpError('Runtime task not found', 404, 'TASK_NOT_FOUND');
    }

    if (!organizationIdsMatch(lookup.orgId, input.organizationId)) {
      throw taskHttpError('Runtime task does not belong to this organization', 403, 'FORBIDDEN');
    }

    const meta = await this.repo.getMetaByLookup(lookup);
    if (!meta) {
      throw taskHttpError('Runtime task not found', 404, 'TASK_NOT_FOUND');
    }

    if (
      meta.assignedToType !== ASSIGNED_TO_TYPE.CARE_TEAM &&
      meta.assignedToType !== ASSIGNED_TO_TYPE.PROVIDER
    ) {
      throw taskHttpError(
        'Staff assignment is only allowed for careTeam or provider tasks',
        422,
        'NOT_STAFF_TASK',
      );
    }

    if (meta.assignedToStaffId && meta.assignedToStaffId === input.assignedToStaffId) {
      throw taskHttpError(
        'Task is already assigned to this staff member',
        422,
        'STAFF_ALREADY_ASSIGNED',
      );
    }

    const { record, historyEntry } = await this.repo.reassignStaffTask({
      meta,
      lookup,
      actorId: input.actorId,
      assignedToStaffId: input.assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
      reason: input.reason,
    });

    return {
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      task: toRuntimeTaskCard(record),
      historyEntry: toTaskHistoryEntry(historyEntry),
    };
  }

  async getRuntimeTaskHistory(input: GetRuntimeTaskHistoryInput): Promise<PaginatedTaskHistory> {
    const lookup = await this.repo.getLookupByTaskId(input.runtimeTaskInstanceId);
    if (!lookup) {
      throw taskHttpError('Runtime task not found', 404, 'TASK_NOT_FOUND');
    }

    if (!organizationIdsMatch(lookup.orgId, input.organizationId)) {
      throw taskHttpError('Runtime task does not belong to this organization', 403, 'FORBIDDEN');
    }

    const exclusiveStartKey = input.nextToken?.trim()
      ? decodeTaskHistoryCursor(input.nextToken)
      : undefined;

    const { items, lastEvaluatedKey } = await this.repo.queryTaskHistoryPage(
      input.runtimeTaskInstanceId,
      input.pageSize,
      exclusiveStartKey,
    );

    return {
      items: items.map(toTaskHistoryEntry),
      nextToken: encodeTaskHistoryCursor(lastEvaluatedKey),
    };
  }

  async generateCarePlanTasks(payload: GenerateCarePlanTasksRequest): Promise<GenerateCarePlanTasksResult> {
    const results: GenerateCarePlanTasksResult['results'] = [];

    for (const linkage of payload.linkages) {
      const taskInput: CreateCarePlanTaskRequest = {
        organizationId: payload.organizationId,
        createdBy: payload.createdBy,
        patientId: payload.patientId,
        patientDisplayName: payload.patientDisplayName,
        carePlanInstanceId: payload.carePlanInstanceId,
        taskGenerationTrigger: payload.taskGenerationTrigger,
        workflowStage: payload.workflowStage,
        ...linkage,
      };

      if (payload.dryRun) {
        const { idempotencyKey, runtimeTaskInstanceId, generationHash } =
          this.repo.buildCarePlanTaskKeys(taskInput);
        const ctx = TaskEntityBuilder.buildCarePlanTaskCreateContext({
          runtimeTaskInstanceId,
          idempotencyKey,
          generationHash,
          input: taskInput,
        });
        const record = TaskEntityBuilder.buildCarePlanMetaRecord(ctx);
        results.push({
          runtimeTaskInstanceId,
          outcome: IDEMPOTENCY_OUTCOME.CREATED,
          task: toRuntimeTaskCard(record, ctx.nowMs),
        });
        continue;
      }

      const { record, outcome } = await this.createCarePlanTaskWithIdempotency(taskInput);
      results.push({
        runtimeTaskInstanceId: record.runtimeTaskInstanceId,
        outcome,
        task: toRuntimeTaskCard(record),
      });
    }

    return { results };
  }

  private async createCarePlanTaskWithIdempotency(
    input: CreateCarePlanTaskRequest,
  ): Promise<CreateMonitoringActionResult> {
    const { runtimeTaskInstanceId } = this.repo.buildCarePlanTaskKeys(input);

    const resolution = await this.repo.resolveCarePlanNaturalKey(
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
        event: 'task_care_plan_idempotent_replay',
        message: 'Idempotent replay for care plan natural key',
        runtimeTaskInstanceId,
        organizationId: input.organizationId,
        carePlanTaskLinkageId: input.carePlanTaskLinkageId,
      });
      return { record: resolution, outcome: IDEMPOTENCY_OUTCOME.SKIPPED_DUPLICATE };
    }

    try {
      const record = await this.repo.createCarePlanTask(input);
      return { record, outcome: IDEMPOTENCY_OUTCOME.CREATED };
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (name === 'TransactionCanceledException' || e instanceof DuplicateTaskError) {
        const again = await this.repo.resolveCarePlanNaturalKey(
          runtimeTaskInstanceId,
          input.organizationId,
        );
        if (again !== 'missing' && again !== 'foreign_org') {
          this.log.warn({
            event: 'task_care_plan_idempotent_after_transaction_race',
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
}

function taskHttpError(message: string, statusCode: number, code: string): Error & {
  statusCode: number;
  code: string;
} {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}
