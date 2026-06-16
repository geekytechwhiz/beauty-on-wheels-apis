import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_RUNTIME_TASK,
  ENTITY_TYPE_TASK_HISTORY,
  ENTITY_TYPE_TASK_LOOKUP,
  MONITORING_SYSTEM_ACTOR,
  TASK_LOOKUP_SK,
} from '../constants/task.constants';
import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import type {
  CompletionEvidenceDdbRecord,
  TaskHistDdbRecord,
  TaskLookupDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import {
  COMPLETION_SOURCE,
  RUNTIME_TASK_SOURCE,
  TASK_HISTORY_EVENT_TYPE,
  TRANSITION_SOURCE,
  type ReminderSettings,
  requiresAssigneeGsi,
} from '../models/types/task-domain.types';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import {
  displayTitleForMonitoringTask,
  displayToPatientForMonitoring,
  initialStateForMonitoringCreate,
  reminderEnabledFromContext,
  taskDisplayGroupForMonitoring,
} from '../utils/monitoring-defaults';
import { buildGenerationHash } from '../utils/monitoring-idempotency';
import { initialStateForRuntimeCreate } from '../utils/runtime-task-create';

import { resolveDueWindowStartAtCreate } from '../utils/task-time';
import {
  buildEvidenceSummaryRollup,
  newCompletionEvidenceId,
} from '../utils/task-state-transition';

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
  assignedToStaffId?: string;
}

export interface CarePlanCreateContext {
  runtimeTaskInstanceId: string;
  idempotencyKey: string;
  generationHash: string;
  nowMs: number;
  input: CreateCarePlanTaskRequest;
  currentState: RuntimeTaskState;
  metaSk: string;
  resolvedDueWindowStart?: number;
  assignedToStaffId?: string;
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
      assignedToStaffId: params.input.assignedToStaffId?.trim() || undefined,
    };
  }

  static buildMonitoringMetaRecord(ctx: MonitoringCreateContext): TaskMetaDdbRecord {
    const {
      input,
      runtimeTaskInstanceId,
      metaSk,
      currentState,
      nowMs,
      idempotencyKey,
      generationHash,
      assignedToStaffId,
    } = ctx;
    const pk = TaskKeyBuilder.buildPatientPartitionKey(input.organizationId, input.patientId);
    const reminderEnabled = reminderEnabledFromContext(input);

    const record: TaskMetaDdbRecord = {
      pk,
      sk: metaSk,
      entityType: ENTITY_TYPE_RUNTIME_TASK,
      orgId: input.organizationId,
      patientId: input.patientId,
      patientDisplayName: input.patientDisplayName,
      runtimeTaskInstanceId,
      runtimeTaskSource: RUNTIME_TASK_SOURCE.MONITORING_RUNTIME,
      carePlanInstanceId: input.carePlanInstanceId,
      monitoringInstanceId: input.monitoringInstanceId,
      taskBehaviorCode: input.taskBehaviorCode,
      taskDisplayGroup: taskDisplayGroupForMonitoring(
        input.taskBehaviorCode,
        input.assignedToType,
      ),
      displayTitle: displayTitleForMonitoringTask(input.taskBehaviorCode),
      assignedToType: input.assignedToType,
      displayToPatient: displayToPatientForMonitoring(input.assignedToType),
      currentState,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      reminderEnabled,
      ...(reminderEnabled && input.reminderContext
        ? { reminderSettings: input.reminderContext as TaskMetaDdbRecord['reminderSettings'] }
        : {}),
      idempotencyKey,
      generationHash,
      createdAt: nowMs,
      createdBy: MONITORING_SYSTEM_ACTOR,
      lastUpdatedAt: nowMs,
      lastUpdatedBy: MONITORING_SYSTEM_ACTOR,
      version: 1,
      sk1: TaskKeyBuilder.buildLsi1Sk(input.carePlanInstanceId, runtimeTaskInstanceId),
    };

    if (assignedToStaffId) record.assignedToStaffId = assignedToStaffId;
    if (input.assignedToStaffDisplayName) {
      record.assignedToStaffDisplayName = input.assignedToStaffDisplayName;
    }

    if (assignedToStaffId && requiresAssigneeGsi(input.assignedToType)) {
      record.gsi1pk = TaskKeyBuilder.buildGsi1Pk(
        input.organizationId,
        input.assignedToType,
        assignedToStaffId,
      );
      record.gsi1sk = TaskKeyBuilder.buildGsi1Sk(
        input.dueWindowStart,
        input.dueWindowEnd,
        input.patientId,
        runtimeTaskInstanceId,
      );
    }

    return record;
  }

  static buildMonitoringLookupRecord(ctx: MonitoringCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, assignedToStaffId } = ctx;

    const lookup: TaskLookupDdbRecord = {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
      entityType: ENTITY_TYPE_TASK_LOOKUP,
      runtimeTaskInstanceId,
      orgId: input.organizationId,
      patientId: input.patientId,
      patientDisplayName: input.patientDisplayName,
      taskSk: metaSk,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      carePlanInstanceId: input.carePlanInstanceId,
      reminderHistory: [],
    };

    if (assignedToStaffId) lookup.assignedToStaffId = assignedToStaffId;
    if (input.assignedToStaffDisplayName) {
      lookup.assignedToStaffDisplayName = input.assignedToStaffDisplayName;
    }

    return lookup;
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
    return {
      runtimeTaskInstanceId,
      nowMs,
      input: params.input,
      currentState,
      metaSk,
      resolvedDueWindowStart,
      assignedToStaffId: params.input.assignedToStaffId,
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
      patientDisplayName: input.patientDisplayName,
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
      sk1: TaskKeyBuilder.buildLsi1Sk(input.carePlanInstanceId, runtimeTaskInstanceId),
    };

    if (input.carePlanInstanceId) record.carePlanInstanceId = input.carePlanInstanceId;
    if (input.workflowStage) record.workflowStage = input.workflowStage;
    if (input.description) record.description = input.description;
    if (assignedToStaffId) record.assignedToStaffId = assignedToStaffId;
    if (input.assignedToStaffDisplayName) {
      record.assignedToStaffDisplayName = input.assignedToStaffDisplayName;
    }
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

    if (assignedToStaffId && requiresAssigneeGsi(input.assignedToType)) {
      record.gsi1pk = TaskKeyBuilder.buildGsi1Pk(
        input.organizationId,
        input.assignedToType,
        assignedToStaffId,
      );
      record.gsi1sk = TaskKeyBuilder.buildGsi1Sk(
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
      patientDisplayName: input.patientDisplayName,
      taskSk: metaSk,
      reminderHistory: [],
    };

    if (resolvedDueWindowStart != null) lookup.dueWindowStart = resolvedDueWindowStart;
    if (input.dueWindowEnd != null) lookup.dueWindowEnd = input.dueWindowEnd;
    if (input.carePlanInstanceId) lookup.carePlanInstanceId = input.carePlanInstanceId;
    if (assignedToStaffId) lookup.assignedToStaffId = assignedToStaffId;
    if (input.assignedToStaffDisplayName) {
      lookup.assignedToStaffDisplayName = input.assignedToStaffDisplayName;
    }

    return lookup;
  }

  static buildCarePlanTaskCreateContext(params: {
    runtimeTaskInstanceId: string;
    idempotencyKey: string;
    generationHash: string;
    input: CreateCarePlanTaskRequest;
    nowMs?: number;
  }): CarePlanCreateContext {
    const nowMs = params.nowMs ?? Date.now();
    const resolvedDueWindowStart = resolveDueWindowStartAtCreate(
      params.input.dueWindowStart,
      params.input.dueWindowEnd,
    );
    const currentState = initialStateForRuntimeCreate(resolvedDueWindowStart, nowMs);
    const metaSk = TaskKeyBuilder.buildMetaSk(
      params.input.dueWindowStart,
      params.input.dueWindowEnd,
      params.runtimeTaskInstanceId,
    );
    return {
      runtimeTaskInstanceId: params.runtimeTaskInstanceId,
      idempotencyKey: params.idempotencyKey,
      generationHash: params.generationHash,
      nowMs,
      input: params.input,
      currentState,
      metaSk,
      resolvedDueWindowStart,
      assignedToStaffId: params.input.assignedToStaffId,
    };
  }

  static buildCarePlanMetaRecord(ctx: CarePlanCreateContext): TaskMetaDdbRecord {
    const {
      input,
      runtimeTaskInstanceId,
      metaSk,
      currentState,
      nowMs,
      idempotencyKey,
      generationHash,
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
      patientDisplayName: input.patientDisplayName,
      runtimeTaskInstanceId,
      runtimeTaskSource: RUNTIME_TASK_SOURCE.CARE_PLAN_TASK_LINKAGE,
      carePlanInstanceId: input.carePlanInstanceId,
      carePlanTaskLinkageId: input.carePlanTaskLinkageId,
      taskGenerationTrigger: input.taskGenerationTrigger,
      taskBehaviorCode: input.taskBehaviorCode,
      taskDisplayGroup: input.taskDisplayGroup,
      displayTitle: input.displayTitle,
      assignedToType: input.assignedToType,
      displayToPatient: input.displayToPatient,
      currentState,
      idempotencyKey,
      generationHash,
      createdAt: nowMs,
      createdBy: input.createdBy,
      lastUpdatedAt: nowMs,
      lastUpdatedBy: input.createdBy,
      version: 1,
      sk1: TaskKeyBuilder.buildLsi1Sk(input.carePlanInstanceId, runtimeTaskInstanceId),
    };

    if (input.workflowStage) record.workflowStage = input.workflowStage;
    if (input.sourceTaskTemplateVersionId) {
      record.sourceTaskTemplateVersionId = input.sourceTaskTemplateVersionId;
    }
    if (input.description) record.description = input.description;
    if (assignedToStaffId) record.assignedToStaffId = assignedToStaffId;
    if (input.assignedToStaffDisplayName) {
      record.assignedToStaffDisplayName = input.assignedToStaffDisplayName;
    }
    if (input.actionTargetId) record.actionTargetId = input.actionTargetId;
    if (input.completionSourceType) record.completionSourceType = input.completionSourceType;
    if (input.completionSourceReferenceId) {
      record.completionSourceReferenceId = input.completionSourceReferenceId;
    }
    if (resolvedDueWindowStart != null) record.dueWindowStart = resolvedDueWindowStart;
    if (input.dueWindowEnd != null) record.dueWindowEnd = input.dueWindowEnd;
    if (input.reminderEnabled != null) record.reminderEnabled = input.reminderEnabled;
    if (input.reminderSettings) record.reminderSettings = input.reminderSettings;
    if (input.requiredForStageCompletion != null) {
      record.requiredForStageCompletion = input.requiredForStageCompletion;
    }
    if (input.displayAsChecklistItem != null) {
      record.displayAsChecklistItem = input.displayAsChecklistItem;
    }

    if (assignedToStaffId && requiresAssigneeGsi(input.assignedToType)) {
      record.gsi1pk = TaskKeyBuilder.buildGsi1Pk(
        input.organizationId,
        input.assignedToType,
        assignedToStaffId,
      );
      record.gsi1sk = TaskKeyBuilder.buildGsi1Sk(
        input.dueWindowStart,
        input.dueWindowEnd,
        input.patientId,
        runtimeTaskInstanceId,
      );
    }

    return record;
  }

  static buildCarePlanLookupRecord(ctx: CarePlanCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, assignedToStaffId, resolvedDueWindowStart } = ctx;

    const lookup: TaskLookupDdbRecord = {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
      entityType: ENTITY_TYPE_TASK_LOOKUP,
      runtimeTaskInstanceId,
      orgId: input.organizationId,
      patientId: input.patientId,
      patientDisplayName: input.patientDisplayName,
      taskSk: metaSk,
      carePlanInstanceId: input.carePlanInstanceId,
      reminderHistory: [],
    };

    if (resolvedDueWindowStart != null) lookup.dueWindowStart = resolvedDueWindowStart;
    if (input.dueWindowEnd != null) lookup.dueWindowEnd = input.dueWindowEnd;
    if (assignedToStaffId) lookup.assignedToStaffId = assignedToStaffId;
    if (input.assignedToStaffDisplayName) {
      lookup.assignedToStaffDisplayName = input.assignedToStaffDisplayName;
    }

    return lookup;
  }

  static buildCarePlanCreateHistRecord(ctx: CarePlanCreateContext): TaskHistDdbRecord {
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
      transitionBy: input.createdBy,
      transitionSource: TRANSITION_SOURCE.SYSTEM,
      transitionReason: `carePlanTaskLinkage create (${input.taskGenerationTrigger})`,
    };
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

  static buildStaffReassignmentHistRecord(params: {
    meta: TaskMetaDdbRecord;
    previousAssignedToStaffId?: string;
    previousAssignedToStaffDisplayName?: string;
    newAssignedToStaffId: string;
    newAssignedToStaffDisplayName: string;
    actorId: string;
    reason?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? Date.now();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return {
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.ASSIGNED_TO_STAFF_CHANGE,
      transitionAt: nowMs,
      transitionBy: params.actorId,
      transitionSource: TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
      previousAssignedToStaffId: params.previousAssignedToStaffId,
      newAssignedToStaffId: params.newAssignedToStaffId,
      previousAssignedToStaffDisplayName: params.previousAssignedToStaffDisplayName,
      newAssignedToStaffDisplayName: params.newAssignedToStaffDisplayName,
    };
  }

  static buildStateChangeHistRecord(params: {
    meta: TaskMetaDdbRecord;
    fromState: RuntimeTaskState;
    toState: RuntimeTaskState;
    actorId: string;
    reason?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? Date.now();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return {
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.STATE_CHANGE,
      fromState: params.fromState,
      toState: params.toState,
      transitionAt: nowMs,
      transitionBy: params.actorId,
      transitionSource: TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
    };
  }

  static buildReminderCancelRequestHistRecord(params: {
    meta: TaskMetaDdbRecord;
    actorId: string;
    reason?: string;
    reminderRecordId?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? Date.now();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return {
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.REMINDER_CANCEL_REQUEST,
      transitionAt: nowMs,
      transitionBy: params.actorId,
      transitionSource: TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
      ...(params.reminderRecordId ? { reminderRecordId: params.reminderRecordId } : {}),
    };
  }

  static buildReminderSettingsChangeHistRecord(params: {
    meta: TaskMetaDdbRecord;
    actorId: string;
    previousReminderEnabled?: boolean;
    newReminderEnabled: boolean;
    previousReminderSettings?: ReminderSettings;
    newReminderSettings?: ReminderSettings;
    reason?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? Date.now();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return {
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.REMINDER_SETTINGS_CHANGE,
      transitionAt: nowMs,
      transitionBy: params.actorId,
      transitionSource: TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
      ...(params.previousReminderEnabled != null
        ? { previousReminderEnabled: params.previousReminderEnabled }
        : {}),
      newReminderEnabled: params.newReminderEnabled,
      ...(params.previousReminderSettings != null
        ? { previousReminderSettings: params.previousReminderSettings }
        : {}),
      ...(params.newReminderSettings != null ? { newReminderSettings: params.newReminderSettings } : {}),
    };
  }

  static buildReminderRegisterRequestHistRecord(params: {
    meta: TaskMetaDdbRecord;
    actorId: string;
    reason?: string;
    reminderChannel?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? Date.now();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return {
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.REMINDER_REGISTER_REQUEST,
      transitionAt: nowMs,
      transitionBy: params.actorId,
      transitionSource: TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
      ...(params.reminderChannel ? { reminderChannel: params.reminderChannel } : {}),
    };
  }

  static buildManualCompletionEvidenceRecord(params: {
    meta: TaskMetaDdbRecord;
    actorId: string;
    completedAt: number;
    evidencePayload?: Record<string, unknown>;
    completionEvidenceId?: string;
  }): CompletionEvidenceDdbRecord {
    const completionEvidenceId = params.completionEvidenceId ?? newCompletionEvidenceId();

    return {
      pk: TaskKeyBuilder.toTaskPk(params.meta.runtimeTaskInstanceId),
      sk: `EVID#${completionEvidenceId}`,
      entityType: 'CompletionEvidence',
      completionEvidenceId,
      runtimeTaskInstanceId: params.meta.runtimeTaskInstanceId,
      orgId: params.meta.orgId,
      patientId: params.meta.patientId,
      completionSource: COMPLETION_SOURCE.MANUAL,
      completedAt: params.completedAt,
      completedBy: params.actorId,
      ...(params.evidencePayload ? { evidencePayload: params.evidencePayload } : {}),
      ...(params.meta.completionSourceType
        ? { completionSourceType: params.meta.completionSourceType }
        : {}),
      ...(params.meta.completionSourceReferenceId
        ? { completionSourceReferenceId: params.meta.completionSourceReferenceId }
        : {}),
    };
  }

  static buildEvidenceSummaryForTransition(
    meta: TaskMetaDdbRecord,
    toState: RuntimeTaskState,
    nowMs: number,
    latestCompletionSummary?: string,
  ) {
    return buildEvidenceSummaryRollup(meta, toState, nowMs, latestCompletionSummary);
  }
}
