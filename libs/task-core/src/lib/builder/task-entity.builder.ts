import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_RUNTIME_TASK,
  ENTITY_TYPE_TASK_HISTORY,
  ENTITY_TYPE_TASK_LOOKUP,
  MONITORING_SYSTEM_ACTOR,
  TASK_LOOKUP_SK,
} from '../constants/task.constants';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import type {
  TaskHistDdbRecord,
  TaskLookupDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import {
  ASSIGNED_TO_TYPE,
  OWNER_TYPE,
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
import { initialStateForRuntimeCreate } from '../utils/runtime-task-create';

import { resolveDueWindowStartAtCreate } from '../utils/task-time';

import { TaskKeyBuilder } from './task-key.builder';

export interface RuntimeTaskCreateContext {
  runtimeTaskInstanceId: string;
  nowMs: number;
  input: CreateRuntimeTaskRequest;
  currentState: RuntimeTaskState;
  metaSk: string;
  resolvedDueWindowStart?: number;
  assignedToStaffId?: string;
}

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

  static buildRuntimeTaskCreateContext(params: {
    input: CreateRuntimeTaskRequest;
    runtimeTaskInstanceId?: string;
    nowMs?: number;
  }): RuntimeTaskCreateContext {
    const nowMs = params.nowMs ?? Date.now();
    const runtimeTaskInstanceId = params.runtimeTaskInstanceId ?? `rtask-${randomUUID()}`;
    const resolvedDueWindowStart = resolveDueWindowStartAtCreate(
      params.input.dueWindowStart,
      params.input.dueWindowEnd,
    );
    const currentState = initialStateForRuntimeCreate(resolvedDueWindowStart, nowMs);
    const metaSk = TaskKeyBuilder.buildMetaSk(
      params.input.dueWindowStart,
      params.input.dueWindowEnd,
      runtimeTaskInstanceId,
    );
    const assignedToStaffId =
      params.input.ownerType === OWNER_TYPE.USER
        ? (params.input.assignedToStaffId ?? params.input.ownerUserId)
        : params.input.assignedToStaffId;

    return {
      runtimeTaskInstanceId,
      nowMs,
      input: params.input,
      currentState,
      metaSk,
      resolvedDueWindowStart,
      assignedToStaffId,
    };
  }

  static buildRuntimeMetaRecord(ctx: RuntimeTaskCreateContext): TaskMetaDdbRecord {
    const {
      input,
      runtimeTaskInstanceId,
      metaSk,
      currentState,
      nowMs,
      assignedToStaffId,
      resolvedDueWindowStart,
    } = ctx;
    const pk = TaskKeyBuilder.buildPatientPartitionKey(input.organizationId, input.patientId);

    const record: TaskMetaDdbRecord = {
      pk,
      sk: metaSk,
      entityType: ENTITY_TYPE_RUNTIME_TASK,
      orgId: input.organizationId,
      patientId: input.patientId,
      runtimeTaskInstanceId,
      runtimeTaskSource: input.runtimeTaskSource,
      taskBehaviorCode: input.taskBehaviorCode,
      taskDisplayGroup: input.taskDisplayGroup,
      displayTitle: input.displayTitle,
      assignedToType: input.assignedToType,
      displayToPatient: input.displayToPatient,
      currentState,
      createdAt: nowMs,
      createdBy: input.createdBy,
      lastUpdatedAt: nowMs,
      lastUpdatedBy: input.createdBy,
      version: 1,
      lsi1Sk: TaskKeyBuilder.buildLsi1Sk(input.carePlanInstanceId, runtimeTaskInstanceId),
    };

    if (input.carePlanInstanceId) record.carePlanInstanceId = input.carePlanInstanceId;
    if (input.workflowStage) record.workflowStage = input.workflowStage;
    if (input.description) record.description = input.description;
    if (assignedToStaffId) record.assignedToStaffId = assignedToStaffId;
    if (input.ownerType) record.ownerType = input.ownerType;
    if (input.ownerUserId) record.ownerUserId = input.ownerUserId;
    if (input.ownerRoleCode) record.ownerRoleCode = input.ownerRoleCode;
    if (input.ownerTeamId) record.ownerTeamId = input.ownerTeamId;
    if (input.ownerDisplayName) record.ownerDisplayName = input.ownerDisplayName;
    if (input.actionTargetId) record.actionTargetId = input.actionTargetId;
    if (input.completionSourceType) record.completionSourceType = input.completionSourceType;
    if (input.completionSourceReferenceId) {
      record.completionSourceReferenceId = input.completionSourceReferenceId;
    }
    if (resolvedDueWindowStart != null) record.dueWindowStart = resolvedDueWindowStart;
    if (input.dueWindowEnd != null) record.dueWindowEnd = input.dueWindowEnd;
    if (input.reminderEnabled != null) record.reminderEnabled = input.reminderEnabled;
    if (input.requiredForStageCompletion != null) {
      record.requiredForStageCompletion = input.requiredForStageCompletion;
    }
    if (input.displayAsChecklistItem != null) {
      record.displayAsChecklistItem = input.displayAsChecklistItem;
    }

    if (input.ownerType === OWNER_TYPE.USER && input.ownerUserId) {
      record.gsi1Pk = TaskKeyBuilder.buildGsi1Pk(input.organizationId, input.ownerUserId);
      record.gsi1Sk = TaskKeyBuilder.buildGsi1Sk(
        input.dueWindowStart,
        input.dueWindowEnd,
        input.patientId,
        runtimeTaskInstanceId,
      );
    }

    return record;
  }

  static buildRuntimeLookupRecord(ctx: RuntimeTaskCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, assignedToStaffId, resolvedDueWindowStart } = ctx;

    const lookup: TaskLookupDdbRecord = {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
      entityType: ENTITY_TYPE_TASK_LOOKUP,
      runtimeTaskInstanceId,
      orgId: input.organizationId,
      patientId: input.patientId,
      taskSk: metaSk,
      reminderHistory: [],
    };

    if (resolvedDueWindowStart != null) lookup.dueWindowStart = resolvedDueWindowStart;
    if (input.dueWindowEnd != null) lookup.dueWindowEnd = input.dueWindowEnd;
    if (input.carePlanInstanceId) lookup.carePlanInstanceId = input.carePlanInstanceId;
    if (assignedToStaffId) lookup.assignedToStaffId = assignedToStaffId;
    if (input.ownerType) lookup.ownerType = input.ownerType;
    if (input.ownerUserId) lookup.ownerUserId = input.ownerUserId;
    if (input.ownerRoleCode) lookup.ownerRoleCode = input.ownerRoleCode;
    if (input.ownerTeamId) lookup.ownerTeamId = input.ownerTeamId;
    if (input.ownerDisplayName) lookup.ownerDisplayName = input.ownerDisplayName;

    return lookup;
  }

  static buildRuntimeCreateHistRecord(ctx: RuntimeTaskCreateContext): TaskHistDdbRecord {
    const { input, runtimeTaskInstanceId, currentState, nowMs } = ctx;
    const taskStateHistoryId = randomUUID();
    const transitionSource =
      input.runtimeTaskSource === RUNTIME_TASK_SOURCE.MANUAL_SYSTEM
        ? TRANSITION_SOURCE.MANUAL
        : TRANSITION_SOURCE.SYSTEM;
    const transitionReason =
      input.runtimeTaskSource === RUNTIME_TASK_SOURCE.MANUAL_SYSTEM
        ? 'manualSystem create'
        : 'serviceFlowRuntime create';

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
      transitionBy: input.createdBy,
      transitionSource,
      transitionReason,
    };
  }
}
