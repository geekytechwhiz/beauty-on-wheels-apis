import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_RUNTIME_TASK,
  ENTITY_TYPE_TASK_HISTORY,
  ENTITY_TYPE_TASK_LOOKUP,
  MONITORING_SYSTEM_ACTOR,
  TASK_LOOKUP_SK,
} from '../constants/task.constants';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type {
  TaskHistDdbRecord,
  TaskLookupDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import {
  ASSIGNED_TO_TYPE,
  RUNTIME_TASK_SOURCE,
  TASK_HISTORY_EVENT_TYPE,
  TRANSITION_SOURCE,
} from '../models/types/task-domain.types';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import {
  displayTitleForMonitoringTask,
  initialStateForMonitoringCreate,
  reminderEnabledFromContext,
  taskDisplayGroupForBehavior,
} from '../utils/monitoring-defaults';
import { buildGenerationHash } from '../utils/monitoring-idempotency';

import { TaskKeyBuilder } from './task-key.builder';

export interface MonitoringCreateContext {
  runtimeTaskInstanceId: string;
  idempotencyKey: string;
  generationHash: string;
  nowMs: number;
  input: CreateMonitoringActionRequest;
  currentState: RuntimeTaskState;
  metaSk: string;
}

export class TaskEntityBuilder {
  static buildMonitoringCreateContext(params: {
    runtimeTaskInstanceId: string;
    idempotencyKey: string;
    input: CreateMonitoringActionRequest;
    nowMs?: number;
  }): MonitoringCreateContext {
    const nowMs = params.nowMs ?? Date.now();
    const currentState = initialStateForMonitoringCreate(params.input.dueWindowStart, nowMs);
    const metaSk = TaskKeyBuilder.buildMetaSk(
      params.input.dueWindowStart,
      params.input.dueWindowEnd,
      params.runtimeTaskInstanceId,
    );

    return {
      runtimeTaskInstanceId: params.runtimeTaskInstanceId,
      idempotencyKey: params.idempotencyKey,
      generationHash: buildGenerationHash(params.idempotencyKey),
      nowMs,
      input: params.input,
      currentState,
      metaSk,
    };
  }

  static buildMonitoringMetaRecord(ctx: MonitoringCreateContext): TaskMetaDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, currentState, nowMs, idempotencyKey, generationHash } =
      ctx;
    const pk = TaskKeyBuilder.buildPatientPartitionKey(input.organizationId, input.patientId);
    const reminderEnabled = reminderEnabledFromContext(input);

    return {
      pk,
      sk: metaSk,
      entityType: ENTITY_TYPE_RUNTIME_TASK,
      orgId: input.organizationId,
      patientId: input.patientId,
      runtimeTaskInstanceId,
      runtimeTaskSource: RUNTIME_TASK_SOURCE.MONITORING_RUNTIME,
      carePlanInstanceId: input.carePlanInstanceId,
      monitoringInstanceId: input.monitoringInstanceId,
      taskBehaviorCode: input.taskBehaviorCode,
      taskDisplayGroup: taskDisplayGroupForBehavior(input.taskBehaviorCode),
      displayTitle: displayTitleForMonitoringTask(input.taskBehaviorCode),
      assignedToType: ASSIGNED_TO_TYPE.PATIENT,
      displayToPatient: true,
      currentState,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      reminderEnabled,
      ...(reminderEnabled && input.reminderContext
        ? { reminderSettings: input.reminderContext as TaskMetaDdbRecord['reminderSettings'] }
        : {}),
      idempotencyKey,
      generationHash,
      lsi1Sk: TaskKeyBuilder.buildLsi1Sk(input.carePlanInstanceId, runtimeTaskInstanceId),
      createdAt: nowMs,
      createdBy: MONITORING_SYSTEM_ACTOR,
      lastUpdatedAt: nowMs,
      lastUpdatedBy: MONITORING_SYSTEM_ACTOR,
      version: 1,
    };
  }

  static buildMonitoringLookupRecord(ctx: MonitoringCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk } = ctx;

    return {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
      entityType: ENTITY_TYPE_TASK_LOOKUP,
      runtimeTaskInstanceId,
      orgId: input.organizationId,
      patientId: input.patientId,
      taskSk: metaSk,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      carePlanInstanceId: input.carePlanInstanceId,
      reminderHistory: [],
    };
  }

  static buildMonitoringCreateHistRecord(ctx: MonitoringCreateContext): TaskHistDdbRecord {
    const { input, runtimeTaskInstanceId, currentState, nowMs } = ctx;
    const taskStateHistoryId = randomUUID();

    return {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId,
      orgId: input.organizationId,
      patientId: input.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.STATE_CHANGE,
      toState: currentState,
      transitionAt: nowMs,
      transitionBy: MONITORING_SYSTEM_ACTOR,
      transitionSource: TRANSITION_SOURCE.SYSTEM,
      transitionReason: 'monitoringRuntime create',
    };
  }
}
