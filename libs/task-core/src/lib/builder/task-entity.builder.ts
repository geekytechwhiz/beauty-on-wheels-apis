import { randomUUID } from 'crypto';

import {
  ENTITY_TYPE_REMINDER,
  ENTITY_TYPE_RUNTIME_TASK,
  ENTITY_TYPE_TASK_HISTORY,
  ENTITY_TYPE_TASK_LOOKUP,
  MONITORING_SYSTEM_ACTOR,
  REMINDER_STREAM_SYSTEM_ACTOR,
  TASK_LOOKUP_SK,
} from '../constants/task.constants';
import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import type {
  CompletionEvidenceDdbRecord,
  ReminderDdbRecord,
  TaskHistDdbRecord,
  TaskLookupDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import {
  COMPLETION_SOURCE,
  RUNTIME_TASK_SOURCE,
  TASK_HISTORY_EVENT_TYPE,
  REMINDER_STATUS,
  TRANSITION_SOURCE,
  type ReminderChannel,
  type ReminderSettings,
  type ReminderStatus,
  type TransitionSource,
  type AssignedToType,
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

import { omitUndefined } from '../utils/omit-undefined';
import { resolveDueWindowStartAtCreate, nowEpochMs } from '../utils/task-time';
import {
  buildEvidenceSummaryRollup,
} from '../utils/task-state-transition';

import { TaskIdBuilder } from './task-id.builder';
import { TaskKeyBuilder } from './task-key.builder';

function assigneeGsiFields(params: {
  organizationId: string;
  assignedToType: AssignedToType;
  assignedToStaffId?: string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  patientId: string;
  runtimeTaskInstanceId: string;
}): { gsi1pk: string | undefined; gsi1sk: string | undefined } {
  const staffId = params.assignedToStaffId;
  if (!staffId || !requiresAssigneeGsi(params.assignedToType)) {
    return { gsi1pk: undefined, gsi1sk: undefined };
  }

  return {
    gsi1pk: TaskKeyBuilder.buildGsi1Pk(params.organizationId, params.assignedToType, staffId),
    gsi1sk: TaskKeyBuilder.buildGsi1Sk(
      params.dueWindowStart,
      params.dueWindowEnd,
      params.patientId,
      params.runtimeTaskInstanceId,
    ),
  };
}

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
    const nowMs = params.nowMs ?? nowEpochMs();
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
    const gsi = assigneeGsiFields({
      organizationId: input.organizationId,
      assignedToType: input.assignedToType,
      assignedToStaffId,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      patientId: input.patientId,
      runtimeTaskInstanceId,
    });

    return omitUndefined({
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
      reminderSettings:
        reminderEnabled && input.reminderContext
          ? (input.reminderContext as TaskMetaDdbRecord['reminderSettings'])
          : undefined,
      idempotencyKey,
      generationHash,
      createdAt: nowMs,
      createdBy: MONITORING_SYSTEM_ACTOR,
      lastUpdatedAt: nowMs,
      lastUpdatedBy: MONITORING_SYSTEM_ACTOR,
      version: 1,
      sk1: TaskKeyBuilder.buildLsi1Sk(input.carePlanInstanceId, runtimeTaskInstanceId),
      assignedToStaffId: assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
      gsi1pk: gsi.gsi1pk,
      gsi1sk: gsi.gsi1sk,
    }) as TaskMetaDdbRecord;
  }

  static buildMonitoringLookupRecord(ctx: MonitoringCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, assignedToStaffId } = ctx;

    return omitUndefined({
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
      assignedToStaffId: assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
    }) as TaskLookupDdbRecord;
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
    const nowMs = params.nowMs ?? nowEpochMs();
    const runtimeTaskInstanceId = params.runtimeTaskInstanceId ?? TaskIdBuilder.newRuntimeTaskInstanceId();
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
    const gsi = assigneeGsiFields({
      organizationId: input.organizationId,
      assignedToType: input.assignedToType,
      assignedToStaffId,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      patientId: input.patientId,
      runtimeTaskInstanceId,
    });

    return omitUndefined({
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
      carePlanInstanceId: input.carePlanInstanceId,
      workflowStage: input.workflowStage,
      description: input.description,
      assignedToStaffId: assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
      actionTargetId: input.actionTargetId,
      completionSourceType: input.completionSourceType,
      completionSourceReferenceId: input.completionSourceReferenceId,
      dueWindowStart: resolvedDueWindowStart ?? undefined,
      dueWindowEnd: input.dueWindowEnd ?? undefined,
      reminderEnabled: input.reminderEnabled ?? undefined,
      requiredForStageCompletion: input.requiredForStageCompletion ?? undefined,
      displayAsChecklistItem: input.displayAsChecklistItem ?? undefined,
      gsi1pk: gsi.gsi1pk,
      gsi1sk: gsi.gsi1sk,
    }) as TaskMetaDdbRecord;
  }

  static buildRuntimeLookupRecord(ctx: RuntimeTaskCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, assignedToStaffId, resolvedDueWindowStart } = ctx;

    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
      entityType: ENTITY_TYPE_TASK_LOOKUP,
      runtimeTaskInstanceId,
      orgId: input.organizationId,
      patientId: input.patientId,
      patientDisplayName: input.patientDisplayName,
      taskSk: metaSk,
      reminderHistory: [],
      dueWindowStart: resolvedDueWindowStart ?? undefined,
      dueWindowEnd: input.dueWindowEnd ?? undefined,
      carePlanInstanceId: input.carePlanInstanceId,
      assignedToStaffId: assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
    }) as TaskLookupDdbRecord;
  }

  static buildCarePlanTaskCreateContext(params: {
    runtimeTaskInstanceId: string;
    idempotencyKey: string;
    generationHash: string;
    input: CreateCarePlanTaskRequest;
    nowMs?: number;
  }): CarePlanCreateContext {
    const nowMs = params.nowMs ?? nowEpochMs();
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
    const gsi = assigneeGsiFields({
      organizationId: input.organizationId,
      assignedToType: input.assignedToType,
      assignedToStaffId,
      dueWindowStart: input.dueWindowStart,
      dueWindowEnd: input.dueWindowEnd,
      patientId: input.patientId,
      runtimeTaskInstanceId,
    });

    return omitUndefined({
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
      workflowStage: input.workflowStage,
      sourceTaskTemplateVersionId: input.sourceTaskTemplateVersionId,
      description: input.description,
      assignedToStaffId: assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
      actionTargetId: input.actionTargetId,
      completionSourceType: input.completionSourceType,
      completionSourceReferenceId: input.completionSourceReferenceId,
      dueWindowStart: resolvedDueWindowStart ?? undefined,
      dueWindowEnd: input.dueWindowEnd ?? undefined,
      reminderEnabled: input.reminderEnabled ?? undefined,
      reminderSettings: input.reminderSettings ?? undefined,
      requiredForStageCompletion: input.requiredForStageCompletion ?? undefined,
      displayAsChecklistItem: input.displayAsChecklistItem ?? undefined,
      gsi1pk: gsi.gsi1pk,
      gsi1sk: gsi.gsi1sk,
    }) as TaskMetaDdbRecord;
  }

  static buildCarePlanLookupRecord(ctx: CarePlanCreateContext): TaskLookupDdbRecord {
    const { input, runtimeTaskInstanceId, metaSk, assignedToStaffId, resolvedDueWindowStart } = ctx;

    return omitUndefined({
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
      dueWindowStart: resolvedDueWindowStart ?? undefined,
      dueWindowEnd: input.dueWindowEnd ?? undefined,
      assignedToStaffId: assignedToStaffId,
      assignedToStaffDisplayName: input.assignedToStaffDisplayName,
    }) as TaskLookupDdbRecord;
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
    const nowMs = params.nowMs ?? nowEpochMs();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return omitUndefined({
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
    }) as TaskHistDdbRecord;
  }

  static buildTaskMetadataChangeHistRecord(params: {
    meta: TaskMetaDdbRecord;
    changedFields: string[];
    previousValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    actorId: string;
    reason?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? nowEpochMs();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.TASK_METADATA_CHANGE,
      transitionAt: nowMs,
      transitionBy: params.actorId,
      transitionSource: TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
      changedFields: params.changedFields,
      previousValues: params.previousValues,
      newValues: params.newValues,
    }) as TaskHistDdbRecord;
  }

  static buildStateChangeHistRecord(params: {
    meta: TaskMetaDdbRecord;
    fromState: RuntimeTaskState;
    toState: RuntimeTaskState;
    actorId: string;
    reason?: string;
    nowMs?: number;
    transitionSource?: TransitionSource;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? nowEpochMs();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return omitUndefined({
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
      transitionSource: params.transitionSource ?? TRANSITION_SOURCE.MANUAL,
      transitionReason: params.reason,
    }) as TaskHistDdbRecord;
  }

  static buildLinkedSourceCompletionEvidenceRecord(params: {
    meta: TaskMetaDdbRecord;
    completionEventId: string;
    completedAt: number;
    completedBy?: string;
  }): CompletionEvidenceDdbRecord {
    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(params.meta.runtimeTaskInstanceId),
      sk: TaskIdBuilder.buildCompletionEvidenceSk(params.completionEventId),
      entityType: 'CompletionEvidence',
      completionEvidenceId: params.completionEventId,
      runtimeTaskInstanceId: params.meta.runtimeTaskInstanceId,
      orgId: params.meta.orgId,
      patientId: params.meta.patientId,
      completionSource: COMPLETION_SOURCE.LINKED_OBJECT,
      completionEventId: params.completionEventId,
      completedAt: params.completedAt,
      completedBy: params.completedBy ?? 'system:linked-source',
      completionSourceType: params.meta.completionSourceType,
      completionSourceReferenceId: params.meta.completionSourceReferenceId,
    }) as CompletionEvidenceDdbRecord;
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
    const nowMs = params.nowMs ?? nowEpochMs();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return omitUndefined({
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
      previousReminderEnabled: params.previousReminderEnabled ?? undefined,
      newReminderEnabled: params.newReminderEnabled,
      previousReminderSettings: params.previousReminderSettings ?? undefined,
      newReminderSettings: params.newReminderSettings ?? undefined,
    }) as TaskHistDdbRecord;
  }

  static buildReminderCurrentRecord(params: {
    runtimeTaskInstanceId: string;
    orgId: string;
    patientId: string;
    reminderRecordId: string;
    scheduledAt: number;
    channel: string;
    schedulerJobId: string;
    reminderStatus?: ReminderStatus;
    nowMs?: number;
    sentAt?: number;
    failureReason?: string;
    suppressedReason?: string;
    createdAt?: number;
  }): ReminderDdbRecord {
    const nowMs = params.nowMs ?? nowEpochMs();
    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(params.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildReminderCurrentSk(),
      entityType: ENTITY_TYPE_REMINDER,
      reminderRecordId: params.reminderRecordId,
      runtimeTaskInstanceId: params.runtimeTaskInstanceId,
      orgId: params.orgId,
      patientId: params.patientId,
      reminderStatus: params.reminderStatus ?? REMINDER_STATUS.SCHEDULED,
      scheduledReminderAt: params.scheduledAt,
      reminderChannel: params.channel as ReminderChannel,
      schedulerJobId: params.schedulerJobId,
      createdAt: params.createdAt ?? nowMs,
      updatedAt: nowMs,
      sentAt: params.sentAt ?? undefined,
      failureReason: params.failureReason,
      suppressedReason: params.suppressedReason,
    }) as ReminderDdbRecord;
  }

  static buildReminderRegisterRequestHistRecord(params: {
    meta: TaskMetaDdbRecord;
    reminderRecordId: string;
    reminderChannel: string;
    schedulerJobId: string;
    scheduledAt: number;
    correlationId?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? nowEpochMs();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.REMINDER_REGISTER_REQUEST,
      transitionAt: nowMs,
      transitionBy: REMINDER_STREAM_SYSTEM_ACTOR,
      transitionSource: TRANSITION_SOURCE.SYSTEM,
      reminderRecordId: params.reminderRecordId,
      reminderChannel: params.reminderChannel,
      schedulerJobId: params.schedulerJobId,
      sourceEventId: params.correlationId,
    }) as TaskHistDdbRecord;
  }

  static buildReminderCancelRequestHistRecord(params: {
    meta: TaskMetaDdbRecord;
    reason: string;
    reminderRecordId?: string;
    reminderChannel?: string;
    schedulerJobId?: string;
    correlationId?: string;
    nowMs?: number;
  }): TaskHistDdbRecord {
    const nowMs = params.nowMs ?? nowEpochMs();
    const taskStateHistoryId = randomUUID();
    const { meta } = params;

    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(meta.runtimeTaskInstanceId),
      sk: TaskKeyBuilder.buildHistSk(nowMs, taskStateHistoryId),
      entityType: ENTITY_TYPE_TASK_HISTORY,
      taskStateHistoryId,
      runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
      orgId: meta.orgId,
      patientId: meta.patientId,
      historyEventType: TASK_HISTORY_EVENT_TYPE.REMINDER_CANCEL_REQUEST,
      transitionAt: nowMs,
      transitionBy: REMINDER_STREAM_SYSTEM_ACTOR,
      transitionSource: TRANSITION_SOURCE.SYSTEM,
      transitionReason: params.reason,
      reminderRecordId: params.reminderRecordId,
      reminderChannel: params.reminderChannel,
      schedulerJobId: params.schedulerJobId,
      sourceEventId: params.correlationId,
    }) as TaskHistDdbRecord;
  }

  static buildManualCompletionEvidenceRecord(params: {
    meta: TaskMetaDdbRecord;
    actorId: string;
    completedAt: number;
    evidencePayload?: Record<string, unknown>;
    completionEvidenceId?: string;
  }): CompletionEvidenceDdbRecord {
    const completionEvidenceId = params.completionEvidenceId ?? TaskIdBuilder.newCompletionEvidenceId();

    return omitUndefined({
      pk: TaskKeyBuilder.toTaskPk(params.meta.runtimeTaskInstanceId),
      sk: TaskIdBuilder.buildCompletionEvidenceSk(completionEvidenceId),
      entityType: 'CompletionEvidence',
      completionEvidenceId,
      runtimeTaskInstanceId: params.meta.runtimeTaskInstanceId,
      orgId: params.meta.orgId,
      patientId: params.meta.patientId,
      completionSource: COMPLETION_SOURCE.MANUAL,
      completedAt: params.completedAt,
      completedBy: params.actorId,
      evidencePayload: params.evidencePayload ?? undefined,
      completionSourceType: params.meta.completionSourceType,
      completionSourceReferenceId: params.meta.completionSourceReferenceId,
    }) as CompletionEvidenceDdbRecord;
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
