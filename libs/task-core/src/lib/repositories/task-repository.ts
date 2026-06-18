import { BaseRepository } from '@api-hub/utils';

import { TaskEntityBuilder } from '../builder/task-entity.builder';
import { TaskKeyBuilder } from '../builder/task-key.builder';
import {
  CARE_PLAN_LSI_INDEX,
  ENTITY_TYPE_RUNTIME_TASK,
  STAFF_TASKS_GSI_INDEX,
  TASK_LOOKUP_SK,
} from '../constants/task.constants';
import {
  RUNTIME_TASK_STATE,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import type { WorkflowStage } from '../models/types/task-domain.types';
import { ASSIGNED_TO_TYPE } from '../models/types/task-domain.types';
import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import type {
  ReassignStaffTaskRepoInput,
  ReassignStaffTaskRepoResult,
} from '../models/api/update-assigned-staff.request';
import type {
  TransitionTaskStateRepoInput,
  TransitionTaskStateRepoResult,
} from '../models/api/update-task-state.request';
import type {
  UpdateReminderSettingsRepoInput,
  UpdateReminderSettingsRepoResult,
} from '../models/api/update-reminder-settings.request';
import type {
  UpdateRuntimeTaskRepoInput,
  UpdateRuntimeTaskRepoResult,
} from '../models/api/update-runtime-task.request';
import type {
  CompletionEvidenceDdbRecord,
  TaskHistDdbRecord,
  TaskLookupDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import { organizationIdsMatch } from '../utils/organization-ids-match';
import { buildCarePlanTaskKeys } from '../utils/monitoring-idempotency';
import {
  buildDeterministicRuntimeTaskInstanceId,
  buildMonitoringIdempotencyKey,
} from '../utils/monitoring-idempotency';
import { cancelReminderHistoryEntries } from '../utils/task-state-transition';
import { assertTaskTable, isMetaConditionalFailure } from '../utils/task.utils';

export type QueryPatientTasksPageInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  currentState?: RuntimeTaskState;
  excludeTerminalStates?: boolean;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryActionCenterTasksPageInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryStaffTasksPageInput = {
  organizationId: string;
  staffUserId: string;
  patientId?: string;
  carePlanInstanceId?: string;
  currentState?: RuntimeTaskState;
  excludeTerminalStates?: boolean;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryCarePlanTasksForSummaryInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId: string;
  workflowStage?: WorkflowStage;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

function buildMetaListFilterExpression(input: {
  workflowStage?: WorkflowStage;
  currentState?: RuntimeTaskState;
  excludeTerminalStates?: boolean;
}): { filterExpression: string; filterValues: Record<string, unknown> } {
  const filterParts = ['entityType = :metaEntity'];
  const filterValues: Record<string, unknown> = {};

  if (input.workflowStage != null) {
    filterParts.push('workflowStage = :workflowStage');
    filterValues[':workflowStage'] = input.workflowStage;
  }
  if (input.currentState != null) {
    filterParts.push('currentState = :currentState');
    filterValues[':currentState'] = input.currentState;
  } else if (input.excludeTerminalStates) {
    filterParts.push(
      'currentState <> :terminalCompleted AND currentState <> :terminalMissed AND currentState <> :terminalDismissed AND currentState <> :terminalCancelled',
    );
    filterValues[':terminalCompleted'] = RUNTIME_TASK_STATE.COMPLETED;
    filterValues[':terminalMissed'] = RUNTIME_TASK_STATE.MISSED;
    filterValues[':terminalDismissed'] = RUNTIME_TASK_STATE.DISMISSED;
    filterValues[':terminalCancelled'] = RUNTIME_TASK_STATE.CANCELLED;
  }

  return { filterExpression: filterParts.join(' AND '), filterValues };
}

export class TaskRepository extends BaseRepository {
  buildMonitoringKeys(input: CreateMonitoringActionRequest): {
    idempotencyKey: string;
    runtimeTaskInstanceId: string;
  } {
    const idempotencyKey = buildMonitoringIdempotencyKey(input);
    const runtimeTaskInstanceId = buildDeterministicRuntimeTaskInstanceId(idempotencyKey);
    return { idempotencyKey, runtimeTaskInstanceId };
  }

  async resolveMonitoringNaturalKey(
    runtimeTaskInstanceId: string,
    organizationId: string,
  ): Promise<TaskMetaDdbRecord | 'missing' | 'foreign_org'> {
    const table = assertTaskTable();
    const lookup = await this.get<TaskLookupDdbRecord>(table, {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
    });
    if (!lookup) return 'missing';
    if (!organizationIdsMatch(lookup.orgId, organizationId)) return 'foreign_org';

    const meta = await this.getMetaByLookup(lookup);
    return meta ?? 'missing';
  }

  async getMetaByLookup(lookup: TaskLookupDdbRecord): Promise<TaskMetaDdbRecord | null> {
    const table = assertTaskTable();
    const patientPk = TaskKeyBuilder.buildPatientPartitionKey(lookup.orgId, lookup.patientId);
    return this.get<TaskMetaDdbRecord>(table, {
      pk: patientPk,
      sk: lookup.taskSk,
    });
  }

  async getLookupByTaskId(runtimeTaskInstanceId: string): Promise<TaskLookupDdbRecord | null> {
    const table = assertTaskTable();
    return this.get<TaskLookupDdbRecord>(table, {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
    });
  }

  async queryTaskHistory(runtimeTaskInstanceId: string): Promise<TaskHistDdbRecord[]> {
    const table = assertTaskTable();
    return this.query<TaskHistDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
        ':prefix': 'HIST#',
      },
      ScanIndexForward: false,
    });
  }

  async queryTaskHistoryPage(
    runtimeTaskInstanceId: string,
    pageSize: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: TaskHistDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTaskTable();
    return this.queryPage<TaskHistDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
        ':prefix': 'HIST#',
      },
      ScanIndexForward: false,
      Limit: pageSize,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    });
  }

  async queryPatientTasksPage(
    input: QueryPatientTasksPageInput,
  ): Promise<{ items: TaskMetaDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTaskTable();
    const pk = TaskKeyBuilder.buildPatientPartitionKey(input.organizationId, input.patientId);

    const expressionValues: Record<string, unknown> = {
      ':pk': pk,
      ':metaEntity': ENTITY_TYPE_RUNTIME_TASK,
    };

    const { filterExpression, filterValues } = buildMetaListFilterExpression({
      workflowStage: input.workflowStage,
      currentState: input.currentState,
      excludeTerminalStates: input.excludeTerminalStates,
    });
    Object.assign(expressionValues, filterValues);

    if (input.carePlanInstanceId?.trim()) {
      const cpPrefix = `CP#${input.carePlanInstanceId.trim()}#`;
      expressionValues[':cpPrefix'] = cpPrefix;
      return this.queryPage<TaskMetaDdbRecord>({
        TableName: table,
        IndexName: CARE_PLAN_LSI_INDEX,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk1, :cpPrefix)',
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
        Limit: input.pageSize,
        ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
      });
    }

    expressionValues[':duePrefix'] = 'DUE#';
    return this.queryPage<TaskMetaDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :duePrefix)',
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
      Limit: input.pageSize,
      ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
    });
  }

  async queryActionCenterTasksPage(
    input: QueryActionCenterTasksPageInput,
  ): Promise<{ items: TaskMetaDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTaskTable();
    const pk = TaskKeyBuilder.buildPatientPartitionKey(input.organizationId, input.patientId);

    const expressionValues: Record<string, unknown> = {
      ':pk': pk,
      ':metaEntity': ENTITY_TYPE_RUNTIME_TASK,
      ':displayToPatient': true,
      ':patientAssignedToType': ASSIGNED_TO_TYPE.PATIENT,
    };

    const filterParts = [
      'entityType = :metaEntity',
      'displayToPatient = :displayToPatient',
      'assignedToType = :patientAssignedToType',
    ];
    if (input.workflowStage != null) {
      filterParts.push('workflowStage = :workflowStage');
      expressionValues[':workflowStage'] = input.workflowStage;
    }
    const filterExpression = filterParts.join(' AND ');

    if (input.carePlanInstanceId?.trim()) {
      const cpPrefix = `CP#${input.carePlanInstanceId.trim()}#`;
      expressionValues[':cpPrefix'] = cpPrefix;
      return this.queryPage<TaskMetaDdbRecord>({
        TableName: table,
        IndexName: CARE_PLAN_LSI_INDEX,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk1, :cpPrefix)',
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
        Limit: input.pageSize,
        ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
      });
    }

    expressionValues[':duePrefix'] = 'DUE#';
    return this.queryPage<TaskMetaDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :duePrefix)',
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionValues,
      Limit: input.pageSize,
      ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
    });
  }

  async queryCarePlanTasksForSummaryPage(
    input: QueryCarePlanTasksForSummaryInput,
  ): Promise<{ items: TaskMetaDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTaskTable();
    const pk = TaskKeyBuilder.buildPatientPartitionKey(input.organizationId, input.patientId);
    const cpPrefix = `CP#${input.carePlanInstanceId.trim()}#`;

    const expressionValues: Record<string, unknown> = {
      ':pk': pk,
      ':metaEntity': ENTITY_TYPE_RUNTIME_TASK,
      ':cpPrefix': cpPrefix,
    };

    const filterParts = ['entityType = :metaEntity'];
    if (input.workflowStage != null) {
      filterParts.push('workflowStage = :workflowStage');
      expressionValues[':workflowStage'] = input.workflowStage;
    }

    return this.queryPage<TaskMetaDdbRecord>({
      TableName: table,
      IndexName: CARE_PLAN_LSI_INDEX,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk1, :cpPrefix)',
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: expressionValues,
      Limit: input.pageSize,
      ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
    });
  }

  async queryStaffTasksPage(
    input: QueryStaffTasksPageInput,
  ): Promise<{ items: TaskMetaDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTaskTable();
    const gsi1pk = TaskKeyBuilder.buildGsi1Pk(
      input.organizationId,
      ASSIGNED_TO_TYPE.ORG_STAFF,
      input.staffUserId,
    );

    const expressionValues: Record<string, unknown> = {
      ':gsi1pk': gsi1pk,
      ':duePrefix': 'DUE#',
      ':metaEntity': ENTITY_TYPE_RUNTIME_TASK,
    };

    const filterParts = ['entityType = :metaEntity'];
    if (input.patientId?.trim()) {
      filterParts.push('patientId = :patientId');
      expressionValues[':patientId'] = input.patientId.trim();
    }
    if (input.carePlanInstanceId?.trim()) {
      filterParts.push('carePlanInstanceId = :carePlanInstanceId');
      expressionValues[':carePlanInstanceId'] = input.carePlanInstanceId.trim();
    }
    if (input.currentState != null) {
      filterParts.push('currentState = :currentState');
      expressionValues[':currentState'] = input.currentState;
    } else if (input.excludeTerminalStates) {
      filterParts.push(
        'currentState <> :terminalCompleted AND currentState <> :terminalMissed AND currentState <> :terminalDismissed AND currentState <> :terminalCancelled',
      );
      expressionValues[':terminalCompleted'] = RUNTIME_TASK_STATE.COMPLETED;
      expressionValues[':terminalMissed'] = RUNTIME_TASK_STATE.MISSED;
      expressionValues[':terminalDismissed'] = RUNTIME_TASK_STATE.DISMISSED;
      expressionValues[':terminalCancelled'] = RUNTIME_TASK_STATE.CANCELLED;
    }

    return this.queryPage<TaskMetaDdbRecord>({
      TableName: table,
      IndexName: STAFF_TASKS_GSI_INDEX,
      KeyConditionExpression: 'gsi1pk = :gsi1pk AND begins_with(gsi1sk, :duePrefix)',
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: expressionValues,
      Limit: input.pageSize,
      ...(input.exclusiveStartKey ? { ExclusiveStartKey: input.exclusiveStartKey } : {}),
    });
  }

  async queryCompletionEvidence(runtimeTaskInstanceId: string): Promise<CompletionEvidenceDdbRecord[]> {
    const table = assertTaskTable();
    return this.query<CompletionEvidenceDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
        ':prefix': 'EVID#',
      },
      ScanIndexForward: false,
    });
  }

  async createMonitoringTask(input: CreateMonitoringActionRequest): Promise<TaskMetaDdbRecord> {
    const table = assertTaskTable();
    const { idempotencyKey, runtimeTaskInstanceId } = this.buildMonitoringKeys(input);

    const ctx = TaskEntityBuilder.buildMonitoringCreateContext({
      runtimeTaskInstanceId,
      idempotencyKey,
      input,
    });

    const metaPut = TaskEntityBuilder.buildMonitoringMetaRecord(ctx);
    const lookupPut = TaskEntityBuilder.buildMonitoringLookupRecord(ctx);
    const histPut = TaskEntityBuilder.buildMonitoringCreateHistRecord(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: metaPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: lookupPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: histPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
        ],
      });

      return metaPut;
    } catch (err: unknown) {
      if (isMetaConditionalFailure(err)) {
        throw new DuplicateTaskError(runtimeTaskInstanceId);
      }
      throw err;
    }
  }

  buildCarePlanTaskKeys(input: CreateCarePlanTaskRequest): {
    idempotencyKey: string;
    runtimeTaskInstanceId: string;
    generationHash: string;
  } {
    return buildCarePlanTaskKeys(input);
  }

  async resolveCarePlanNaturalKey(
    runtimeTaskInstanceId: string,
    organizationId: string,
  ): Promise<TaskMetaDdbRecord | 'missing' | 'foreign_org'> {
    return this.resolveMonitoringNaturalKey(runtimeTaskInstanceId, organizationId);
  }

  async createCarePlanTask(input: CreateCarePlanTaskRequest): Promise<TaskMetaDdbRecord> {
    const table = assertTaskTable();
    const { idempotencyKey, runtimeTaskInstanceId, generationHash } = this.buildCarePlanTaskKeys(input);

    const ctx = TaskEntityBuilder.buildCarePlanTaskCreateContext({
      runtimeTaskInstanceId,
      idempotencyKey,
      generationHash,
      input,
    });

    const metaPut = TaskEntityBuilder.buildCarePlanMetaRecord(ctx);
    const lookupPut = TaskEntityBuilder.buildCarePlanLookupRecord(ctx);
    const histPut = TaskEntityBuilder.buildCarePlanCreateHistRecord(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: metaPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: lookupPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: histPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
        ],
      });

      return metaPut;
    } catch (err: unknown) {
      if (isMetaConditionalFailure(err)) {
        throw new DuplicateTaskError(runtimeTaskInstanceId);
      }
      throw err;
    }
  }

  async createRuntimeTask(input: CreateRuntimeTaskRequest): Promise<TaskMetaDdbRecord> {
    const table = assertTaskTable();
    const ctx = TaskEntityBuilder.buildRuntimeTaskCreateContext({ input });

    const metaPut = TaskEntityBuilder.buildRuntimeMetaRecord(ctx);
    const lookupPut = TaskEntityBuilder.buildRuntimeLookupRecord(ctx);
    const histPut = TaskEntityBuilder.buildRuntimeCreateHistRecord(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: metaPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: lookupPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: histPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
        ],
      });

      return metaPut;
    } catch (err: unknown) {
      if (isMetaConditionalFailure(err)) {
        throw new DuplicateTaskError(ctx.runtimeTaskInstanceId);
      }
      throw err;
    }
  }

  async reassignStaffTask(input: ReassignStaffTaskRepoInput): Promise<ReassignStaffTaskRepoResult> {
    const table = assertTaskTable();
    const { meta, lookup, actorId, assignedToStaffId, assignedToStaffDisplayName, reason } = input;
    const nowMs = Date.now();
    const gsi1pk = TaskKeyBuilder.buildGsi1Pk(
      meta.orgId,
      ASSIGNED_TO_TYPE.ORG_STAFF,
      assignedToStaffId,
    );
    const isFirstAssignment = !meta.assignedToStaffId;
    const gsi1sk =
      meta.gsi1sk ??
      TaskKeyBuilder.buildGsi1Sk(
        meta.dueWindowStart ?? lookup.dueWindowStart,
        meta.dueWindowEnd ?? lookup.dueWindowEnd,
        meta.patientId,
        meta.runtimeTaskInstanceId,
      );
    const metaUpdateExpression = isFirstAssignment
      ? 'SET assignedToStaffId = :staffId, assignedToStaffDisplayName = :staffDisplayName, gsi1pk = :gsi1pk, gsi1sk = :gsi1sk, lastUpdatedAt = :now, lastUpdatedBy = :by'
      : 'SET assignedToStaffId = :staffId, assignedToStaffDisplayName = :staffDisplayName, gsi1pk = :gsi1pk, lastUpdatedAt = :now, lastUpdatedBy = :by';
    const metaExpressionValues: Record<string, unknown> = {
      ':staffId': assignedToStaffId,
      ':staffDisplayName': assignedToStaffDisplayName,
      ':gsi1pk': gsi1pk,
      ':now': nowMs,
      ':by': actorId,
    };
    if (isFirstAssignment) {
      metaExpressionValues[':gsi1sk'] = gsi1sk;
    }
    const histPut = TaskEntityBuilder.buildStaffReassignmentHistRecord({
      meta,
      previousAssignedToStaffId: meta.assignedToStaffId,
      previousAssignedToStaffDisplayName: meta.assignedToStaffDisplayName,
      newAssignedToStaffId: assignedToStaffId,
      newAssignedToStaffDisplayName: assignedToStaffDisplayName,
      actorId,
      reason,
      nowMs,
    });

    await this.transactWrite({
      TransactItems: [
        {
          Update: {
            TableName: table,
            Key: { pk: meta.pk, sk: meta.sk },
            UpdateExpression: metaUpdateExpression,
            ExpressionAttributeValues: metaExpressionValues,
            ConditionExpression: 'attribute_exists(sk)',
          },
        },
        {
          Update: {
            TableName: table,
            Key: { pk: lookup.pk, sk: lookup.sk },
            UpdateExpression:
              'SET assignedToStaffId = :staffId, assignedToStaffDisplayName = :staffDisplayName',
            ExpressionAttributeValues: {
              ':staffId': assignedToStaffId,
              ':staffDisplayName': assignedToStaffDisplayName,
            },
            ConditionExpression: 'attribute_exists(sk)',
          },
        },
        {
          Put: {
            TableName: table,
            Item: histPut as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(sk)',
          },
        },
      ],
    });

    return {
      record: {
        ...meta,
        assignedToStaffId,
        assignedToStaffDisplayName,
        gsi1pk,
        gsi1sk: meta.gsi1sk ?? gsi1sk,
        lastUpdatedAt: nowMs,
        lastUpdatedBy: actorId,
      },
      historyEntry: histPut,
    };
  }

  async transitionTaskState(input: TransitionTaskStateRepoInput): Promise<TransitionTaskStateRepoResult> {
    const table = assertTaskTable();
    const {
      meta,
      lookup,
      fromState,
      toState,
      expectedPersistedState,
      actorId,
      reason,
      evidencePayload,
    } = input;
    const nowMs = input.nowMs ?? Date.now();
    const nextVersion = (meta.version ?? 1) + 1;

    const stateHistPut = TaskEntityBuilder.buildStateChangeHistRecord({
      meta,
      fromState,
      toState,
      actorId,
      reason,
      nowMs,
    });

    const transactItems: Parameters<typeof this.transactWrite>[0]['TransactItems'] = [
      {
        Update: {
          TableName: table,
          Key: { pk: meta.pk, sk: meta.sk },
          UpdateExpression:
            'SET currentState = :toState, lastUpdatedAt = :now, lastUpdatedBy = :by, #ver = :nextVer',
          ExpressionAttributeNames: { '#ver': 'version' },
          ExpressionAttributeValues: {
            ':toState': toState,
            ':now': nowMs,
            ':by': actorId,
            ':nextVer': nextVersion,
            ':expected': expectedPersistedState,
          },
          ConditionExpression: 'currentState = :expected',
        },
      },
      {
        Put: {
          TableName: table,
          Item: stateHistPut as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(sk)',
        },
      },
    ];

    const terminalWithReminderCancel = new Set<RuntimeTaskState>([
      RUNTIME_TASK_STATE.COMPLETED,
      RUNTIME_TASK_STATE.DISMISSED,
      RUNTIME_TASK_STATE.CANCELLED,
      RUNTIME_TASK_STATE.MISSED,
    ]);

    let hadCancellableReminders = false;
    let reminderCancelHistEntry: TaskHistDdbRecord | undefined;

    if (terminalWithReminderCancel.has(toState)) {
      const { entries, hadCancellable } = cancelReminderHistoryEntries(
        lookup.reminderHistory,
        nowMs,
      );
      hadCancellableReminders = hadCancellable;

      const lookupUpdateValues: Record<string, unknown> = {
        ':reminderHistory': entries,
      };
      let lookupUpdateExpression = 'SET reminderHistory = :reminderHistory';

      if (toState === RUNTIME_TASK_STATE.COMPLETED) {
        const evidenceSummary = TaskEntityBuilder.buildEvidenceSummaryForTransition(
          meta,
          toState,
          nowMs,
        );
        lookupUpdateExpression += ', evidenceSummary = :evidenceSummary';
        lookupUpdateValues[':evidenceSummary'] = evidenceSummary;
      } else if (toState === RUNTIME_TASK_STATE.MISSED) {
        const evidenceSummary = TaskEntityBuilder.buildEvidenceSummaryForTransition(
          meta,
          toState,
          nowMs,
        );
        lookupUpdateExpression += ', evidenceSummary = :evidenceSummary';
        lookupUpdateValues[':evidenceSummary'] = evidenceSummary;
      }

      transactItems.push({
        Update: {
          TableName: table,
          Key: { pk: lookup.pk, sk: lookup.sk },
          UpdateExpression: lookupUpdateExpression,
          ExpressionAttributeValues: lookupUpdateValues,
          ConditionExpression: 'attribute_exists(sk)',
        },
      });

      if (
        hadCancellable &&
        (toState === RUNTIME_TASK_STATE.COMPLETED ||
          toState === RUNTIME_TASK_STATE.DISMISSED ||
          toState === RUNTIME_TASK_STATE.CANCELLED)
      ) {
        reminderCancelHistEntry = TaskEntityBuilder.buildReminderCancelRequestHistRecord({
          meta,
          actorId,
          reason,
          nowMs: nowMs + 1,
        });
        transactItems.push({
          Put: {
            TableName: table,
            Item: reminderCancelHistEntry as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(sk)',
          },
        });
      }
    }

    if (toState === RUNTIME_TASK_STATE.COMPLETED && evidencePayload != null) {
      const evidPut = TaskEntityBuilder.buildManualCompletionEvidenceRecord({
        meta,
        actorId,
        completedAt: nowMs,
        evidencePayload,
      });
      transactItems.push({
        Put: {
          TableName: table,
          Item: evidPut as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(sk)',
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });

    return {
      record: {
        ...meta,
        currentState: toState,
        lastUpdatedAt: nowMs,
        lastUpdatedBy: actorId,
        version: nextVersion,
      },
      historyEntry: stateHistPut,
      reminderCancelHistEntry,
      hadCancellableReminders,
    };
  }

  async updateReminderSettings(
    input: UpdateReminderSettingsRepoInput,
  ): Promise<UpdateReminderSettingsRepoResult> {
    const table = assertTaskTable();
    const { meta, actorId, reminderEnabled, reminderSettings, reason, coordination } = input;
    const nowMs = Date.now();
    const nextVersion = (meta.version ?? 1) + 1;

    const settingsChangeHist = TaskEntityBuilder.buildReminderSettingsChangeHistRecord({
      meta,
      actorId,
      previousReminderEnabled: meta.reminderEnabled,
      newReminderEnabled: reminderEnabled,
      previousReminderSettings: meta.reminderSettings,
      newReminderSettings: reminderSettings,
      reason,
      nowMs,
    });

    const metaUpdateValues: Record<string, unknown> = {
      ':reminderEnabled': reminderEnabled,
      ':now': nowMs,
      ':by': actorId,
      ':nextVer': nextVersion,
    };
    let metaUpdateExpression =
      'SET reminderEnabled = :reminderEnabled, lastUpdatedAt = :now, lastUpdatedBy = :by, #ver = :nextVer';
    if (reminderSettings !== undefined) {
      metaUpdateExpression += ', reminderSettings = :reminderSettings';
      metaUpdateValues[':reminderSettings'] = reminderSettings;
    }

    const transactItems: Parameters<typeof this.transactWrite>[0]['TransactItems'] = [
      {
        Update: {
          TableName: table,
          Key: { pk: meta.pk, sk: meta.sk },
          UpdateExpression: metaUpdateExpression,
          ExpressionAttributeNames: { '#ver': 'version' },
          ExpressionAttributeValues: metaUpdateValues,
          ConditionExpression: 'attribute_exists(sk)',
        },
      },
      {
        Put: {
          TableName: table,
          Item: settingsChangeHist as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(sk)',
        },
      },
    ];

    let cancelRequestHist: TaskHistDdbRecord | undefined;
    let registerRequestHist: TaskHistDdbRecord | undefined;
    let histOffset = 1;

    if (coordination.shouldCancel) {
      cancelRequestHist = TaskEntityBuilder.buildReminderCancelRequestHistRecord({
        meta,
        actorId,
        reason,
        nowMs: nowMs + histOffset,
      });
      histOffset++;
      transactItems.push({
        Put: {
          TableName: table,
          Item: cancelRequestHist as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(sk)',
        },
      });
    }

    if (coordination.shouldRegister) {
      registerRequestHist = TaskEntityBuilder.buildReminderRegisterRequestHistRecord({
        meta,
        actorId,
        reason,
        reminderChannel: reminderSettings?.channels?.[0],
        nowMs: nowMs + histOffset,
      });
      transactItems.push({
        Put: {
          TableName: table,
          Item: registerRequestHist as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(sk)',
        },
      });
    }

    await this.transactWrite({ TransactItems: transactItems });

    return {
      record: {
        ...meta,
        reminderEnabled,
        ...(reminderSettings !== undefined ? { reminderSettings } : {}),
        lastUpdatedAt: nowMs,
        lastUpdatedBy: actorId,
        version: nextVersion,
      },
      settingsChangeHist,
      ...(cancelRequestHist ? { cancelRequestHist } : {}),
      ...(registerRequestHist ? { registerRequestHist } : {}),
      coordination,
    };
  }

  async updateRuntimeTask(input: UpdateRuntimeTaskRepoInput): Promise<UpdateRuntimeTaskRepoResult> {
    const table = assertTaskTable();
    const { meta, lookup, actorId, reason, diff } = input;
    const nowMs = Date.now();
    const nextVersion = (meta.version ?? 1) + 1;

    const expressionParts: string[] = [
      'lastUpdatedAt = :now',
      'lastUpdatedBy = :by',
      '#ver = :nextVer',
    ];
    const expressionNames: Record<string, string> = { '#ver': 'version' };
    const expressionValues: Record<string, unknown> = {
      ':now': nowMs,
      ':by': actorId,
      ':nextVer': nextVersion,
    };

    for (const field of diff.changedFields) {
      const attrName = `#${field}`;
      const valueKey = `:${field}`;
      expressionNames[attrName] = field;
      expressionValues[valueKey] = diff.newValues[field];
      expressionParts.push(`${attrName} = ${valueKey}`);
    }

    const histPut = TaskEntityBuilder.buildTaskMetadataChangeHistRecord({
      meta,
      changedFields: [...diff.changedFields],
      previousValues: diff.previousValues as Record<string, unknown>,
      newValues: diff.newValues as Record<string, unknown>,
      actorId,
      reason,
      nowMs,
    });

    const transactItems: Parameters<typeof this.transactWrite>[0]['TransactItems'] = [
      {
        Update: {
          TableName: table,
          Key: { pk: meta.pk, sk: meta.sk },
          UpdateExpression: `SET ${expressionParts.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ConditionExpression: 'attribute_exists(sk)',
        },
      },
    ];

    if (diff.lookupUpdates.patientDisplayName != null) {
      transactItems.push({
        Update: {
          TableName: table,
          Key: { pk: lookup.pk, sk: lookup.sk },
          UpdateExpression: 'SET patientDisplayName = :patientDisplayName',
          ExpressionAttributeValues: {
            ':patientDisplayName': diff.lookupUpdates.patientDisplayName,
          },
          ConditionExpression: 'attribute_exists(sk)',
        },
      });
    }

    transactItems.push({
      Put: {
        TableName: table,
        Item: histPut as unknown as Record<string, unknown>,
        ConditionExpression: 'attribute_not_exists(sk)',
      },
    });

    await this.transactWrite({ TransactItems: transactItems });

    return {
      record: {
        ...meta,
        ...diff.metaUpdates,
        lastUpdatedAt: nowMs,
        lastUpdatedBy: actorId,
        version: nextVersion,
      },
      historyEntry: histPut,
    };
  }
}
