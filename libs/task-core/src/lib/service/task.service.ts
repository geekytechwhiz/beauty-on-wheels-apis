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
import type {
  UpdateRuntimeTaskRequest,
  UpdateRuntimeTaskResult,
} from '../models/api/update-runtime-task.request';
import type {
  UpdateReminderSettingsRequest,
  UpdateReminderSettingsResult,
} from '../models/api/update-reminder-settings.request';
import type {
  UpdateTaskStateRequest,
  UpdateTaskStateResult,
} from '../models/api/update-task-state.request';
import type {
  GetTaskStatusSummaryInput,
  TaskStatusSummaryResult,
} from '../models/api/get-task-status-summary.types';
import { ASSIGNED_TO_TYPE, isPatientAssignedToType } from '../models/types/task-domain.types';
import type {
  CompletionEvidenceDdbRecord,
  TaskEvidenceSummaryDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import {
  RUNTIME_TASK_STATE,
  normalizeCurrentStateForWire,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import {
  IDEMPOTENCY_OUTCOME,
  SURFACE_SECTION,
  type IdempotencyOutcome,
  type SurfaceSection,
  type WorkflowStage,
} from '../models/types/task-domain.types';
import { toActionCenterTaskCard, toRuntimeTaskCard, toTaskHistoryEntry } from '../mappers/task-http.dto';
import { TaskRepository } from '../repositories/task-repository';
// Reminder EventBridge integration disabled until reminder scheduler consumes task-service bus.
// import { publishCancelReminderJobs, publishRegisterReminderJobs } from '../events/task-command.publisher';
import { prepareAssignedToTypeInput } from '../utils/assigned-to-type.validation';
import {
  mergeReminderSettingsForUpdate,
  reminderSettingsEqual,
  // resolveReminderCoordination,
  isReminderRegistrationEligible,
} from '../utils/reminder-settings';
import { organizationIdsMatch } from '../utils/organization-ids-match';
import { resolveTaskStateTransition } from '../utils/task-workflow';
import { isMetaConditionalFailure } from '../utils/task.utils';
import {
  type ActionCenterSurfaceFilter,
  deriveActionCenterSurfaceSection,
  emptyActionCenterSections,
  isCarePlanChecklistEligible,
  matchesActionCenterFilter,
} from '../utils/surface-section';
import { DEFAULT_ACTION_CENTER_TIMEZONE } from '../utils/task-time';
import { aggregateTaskStatusSummary } from '../utils/task-status-summary';
import {
  assertRequiredForStageCompletionAllowed,
  computeRuntimeTaskMetadataDiff,
} from '../utils/runtime-task-metadata';
import {
  decodeTaskHistoryCursor,
  encodeTaskHistoryCursor,
  TASK_LIST_MAX_PAGE_SIZE,
  TASK_LIST_SURFACE_FILTER_MAX_ROUNDS,
  TASK_STATUS_SUMMARY_MAX_QUERY_ROUNDS,
} from '../utils/task.utils';

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

export type RuntimeTaskCard = ReturnType<typeof toRuntimeTaskCard>;

export type ListPatientTasksInput = {
  organizationId: string;
  patientId: string;
  staffUserId?: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  currentState?: RuntimeTaskState;
  pageSize: number;
  nextToken?: string;
};

export type PatientTaskListResult = {
  patientId: string;
  staffUserId?: string;
  patientTasks: { items: RuntimeTaskCard[] };
  staffTasks: { items: RuntimeTaskCard[] };
  nextToken?: string;
};

export type ListStaffTasksInput = {
  organizationId: string;
  staffUserId: string;
  patientId?: string;
  carePlanInstanceId?: string;
  currentState?: RuntimeTaskState;
  pageSize: number;
  nextToken?: string;
};

export type PaginatedRuntimeTaskCards = {
  items: RuntimeTaskCard[];
  nextToken?: string;
};

export type ActionCenterTaskCard = ReturnType<typeof toActionCenterTaskCard>;

export type ListActionCenterItemsInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  surfaceSection: ActionCenterSurfaceFilter;
  timezone?: string;
  pageSize: number;
  nextToken?: string;
};

export type ActionCenterGroupedResult = {
  patientId: string;
  carePlanInstanceId?: string;
  timezone: string;
  sections: Record<SurfaceSection, ActionCenterTaskCard[]>;
  nextToken?: string;
};

export type ActionCenterSingleSectionResult = {
  patientId: string;
  carePlanInstanceId?: string;
  timezone: string;
  surfaceSection: SurfaceSection;
  items: ActionCenterTaskCard[];
  nextToken?: string;
};

export type ActionCenterItemsResult = ActionCenterGroupedResult | ActionCenterSingleSectionResult;

export type { GetTaskStatusSummaryInput, TaskStatusSummaryResult };

export class TaskService extends BaseTaskService {
  constructor(repo?: TaskRepository, log?: Logger) {
    super(repo, log);
  }

  async createMonitoringAction(
    payload: CreateMonitoringActionPayload,
  ): Promise<CreateMonitoringActionResult> {
    const input = prepareAssignedToTypeInput({ ...payload });
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
    const input = prepareAssignedToTypeInput({ ...payload });
    const record = await this.repo.createRuntimeTask(input);
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

    if (meta.assignedToType !== ASSIGNED_TO_TYPE.ORG_STAFF) {
      throw taskHttpError('Staff assignment is only allowed for orgStaff tasks', 422, 'NOT_STAFF_TASK');
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

  async updateRuntimeTask(input: UpdateRuntimeTaskRequest): Promise<UpdateRuntimeTaskResult> {
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

    try {
      assertRequiredForStageCompletionAllowed(meta.currentState, input.patch);
    } catch (e: unknown) {
      const err = e as Error & { statusCode?: number; code?: string };
      if (err.statusCode && err.code) {
        throw err;
      }
      throw e;
    }

    const diff = computeRuntimeTaskMetadataDiff(meta, input.patch);
    if (!diff) {
      throw taskHttpError('Task metadata is unchanged', 422, 'TASK_METADATA_UNCHANGED');
    }

    const { record, historyEntry } = await this.repo.updateRuntimeTask({
      meta,
      lookup,
      actorId: input.actorId,
      reason: input.reason,
      diff,
    });

    return {
      runtimeTaskInstanceId: record.runtimeTaskInstanceId,
      task: toRuntimeTaskCard(record),
      historyEntry: toTaskHistoryEntry(historyEntry),
    };
  }

  async updateReminderSettings(
    input: UpdateReminderSettingsRequest,
    options?: { correlationId?: string },
  ): Promise<UpdateReminderSettingsResult> {
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

    const nextReminderSettings = mergeReminderSettingsForUpdate(
      meta.reminderSettings,
      input.reminderSettings,
    );
    const nextReminderEnabled = input.reminderEnabled;

    if (
      meta.reminderEnabled === nextReminderEnabled &&
      reminderSettingsEqual(meta.reminderSettings, nextReminderSettings)
    ) {
      throw taskHttpError('Reminder settings are unchanged', 422, 'REMINDER_SETTINGS_UNCHANGED');
    }

    if (nextReminderEnabled && !isReminderRegistrationEligible(meta.currentState)) {
      throw taskHttpError(
        'Reminders cannot be enabled for a task in a terminal state',
        422,
        'REMINDER_NOT_ELIGIBLE',
      );
    }

    // Reminder scheduler coordination disabled until EventBridge bus is integrated.
    // const coordination = resolveReminderCoordination({
    //   previousEnabled: meta.reminderEnabled,
    //   previousSettings: meta.reminderSettings,
    //   newEnabled: nextReminderEnabled,
    //   newSettings: nextReminderSettings,
    //   currentState: meta.currentState,
    // });
    const coordination = { shouldCancel: false, shouldRegister: false };

    const result = await this.repo.updateReminderSettings({
      meta,
      actorId: input.actorId,
      reminderEnabled: nextReminderEnabled,
      reminderSettings: nextReminderSettings,
      reason: input.reason,
      coordination,
    });

    // if (coordination.shouldCancel) {
    //   await publishCancelReminderJobs(
    //     {
    //       runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    //       patientId: meta.patientId,
    //       reason: input.reason,
    //     },
    //     options?.correlationId,
    //   );
    // }

    // if (coordination.shouldRegister) {
    //   await publishRegisterReminderJobs(
    //     {
    //       runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    //       patientId: meta.patientId,
    //       scheduledReminderAt: lookup.dueWindowEnd ?? lookup.dueWindowStart ?? meta.dueWindowEnd,
    //       reminderChannel: nextReminderSettings?.channels?.[0],
    //     },
    //     options?.correlationId,
    //   );
    // }

    return {
      runtimeTaskInstanceId: result.record.runtimeTaskInstanceId,
      reminderEnabled: result.record.reminderEnabled ?? false,
      ...(result.record.reminderSettings != null
        ? { reminderSettings: result.record.reminderSettings }
        : {}),
      historyEntry: toTaskHistoryEntry(result.settingsChangeHist),
    };
  }

  async updateTaskState(
    input: UpdateTaskStateRequest,
    options?: { correlationId?: string },
  ): Promise<UpdateTaskStateResult> {
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

    let transition;
    try {
      transition = resolveTaskStateTransition(
        meta,
        input.action,
        input.expectedCurrentState,
        input.actorType,
      );
    } catch (e: unknown) {
      const err = e as Error & { statusCode?: number; code?: string };
      if (err.statusCode && err.code) {
        throw err;
      }
      throw e;
    }

    let result;
    try {
      result = await this.repo.transitionTaskState({
        meta,
        lookup,
        fromState: transition.fromState,
        toState: transition.toState,
        expectedPersistedState: transition.expectedPersistedState,
        actorId: input.actorId,
        reason: input.reason,
        evidencePayload: input.evidencePayload,
      });
    } catch (e: unknown) {
      if (isMetaConditionalFailure(e)) {
        throw taskHttpError(
          'Task state has changed; retry with the current state',
          409,
          'EXPECTED_STATE_MISMATCH',
        );
      }
      throw e;
    }

    // Reminder scheduler coordination disabled until EventBridge bus is integrated.
    // if (
    //   result.hadCancellableReminders &&
    //   terminalCancelStates.includes(transition.toState)
    // ) {
    //   await publishCancelReminderJobs(
    //     {
    //       runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    //       patientId: meta.patientId,
    //       reason: input.reason,
    //     },
    //     options?.correlationId,
    //   );
    // }

    const surfaceSection = deriveActionCenterSurfaceSection(
      {
        currentState: result.record.currentState,
        dueWindowStart: result.record.dueWindowStart,
        dueWindowEnd: result.record.dueWindowEnd,
        displayAsChecklistItem: result.record.displayAsChecklistItem,
      },
      DEFAULT_ACTION_CENTER_TIMEZONE,
    );

    return {
      runtimeTaskInstanceId: result.record.runtimeTaskInstanceId,
      currentState: normalizeCurrentStateForWire(result.record.currentState),
      surfaceSection,
      historyEntry: toTaskHistoryEntry(result.historyEntry),
    };
  }

  async listPatientTasks(input: ListPatientTasksInput): Promise<PatientTaskListResult> {
    const exclusiveStartKey = input.nextToken?.trim()
      ? decodeTaskHistoryCursor(input.nextToken)
      : undefined;

    const page = await this.repo.queryPatientTasksPage({
      organizationId: input.organizationId,
      patientId: input.patientId,
      carePlanInstanceId: input.carePlanInstanceId,
      workflowStage: input.workflowStage,
      currentState: input.currentState,
      excludeTerminalStates: input.currentState == null,
      pageSize: input.pageSize,
      exclusiveStartKey,
    });

    const patientTasks: RuntimeTaskCard[] = [];
    const staffTasks: RuntimeTaskCard[] = [];
    const staffUserId = input.staffUserId?.trim();

    for (const record of page.items) {
      const card = toRuntimeTaskCard(record);
      if (isPatientAssignedToType(card.assignedToType)) {
        patientTasks.push(card);
      } else if (
        card.assignedToType === ASSIGNED_TO_TYPE.ORG_STAFF &&
        staffUserId &&
        card.assignedToStaffId === staffUserId
      ) {
        staffTasks.push(card);
      }
    }

    return {
      patientId: input.patientId,
      ...(staffUserId ? { staffUserId } : {}),
      patientTasks: { items: sortRuntimeTaskCardsByDue(patientTasks) },
      staffTasks: { items: sortRuntimeTaskCardsByDue(staffTasks) },
      nextToken: encodeTaskHistoryCursor(page.lastEvaluatedKey),
    };
  }

  async listActionCenterItems(input: ListActionCenterItemsInput): Promise<ActionCenterItemsResult> {
    const timeZone = input.timezone?.trim() || DEFAULT_ACTION_CENTER_TIMEZONE;
    const exclusiveStartKey = input.nextToken?.trim()
      ? decodeTaskHistoryCursor(input.nextToken)
      : undefined;

    const queryBase = {
      organizationId: input.organizationId,
      patientId: input.patientId,
      carePlanInstanceId: input.carePlanInstanceId,
      workflowStage: input.workflowStage,
      pageSize: input.pageSize,
    };

    if (input.surfaceSection === 'all') {
      const page = await this.repo.queryActionCenterTasksPage({
        ...queryBase,
        exclusiveStartKey,
      });
      const sections = emptyActionCenterSections() as Record<SurfaceSection, ActionCenterTaskCard[]>;

      for (const record of page.items) {
        this.appendActionCenterRecord(sections, record, timeZone);
      }

      for (const key of Object.keys(sections) as SurfaceSection[]) {
        sections[key] = sortActionCenterCardsByDue(sections[key]);
      }

      return {
        patientId: input.patientId,
        ...(input.carePlanInstanceId ? { carePlanInstanceId: input.carePlanInstanceId } : {}),
        timezone: timeZone,
        sections,
        nextToken: encodeTaskHistoryCursor(page.lastEvaluatedKey),
      };
    }

    const filter = input.surfaceSection;
    const collected: ActionCenterTaskCard[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    let exclusiveKey = exclusiveStartKey;
    let rounds = 0;

    do {
      const page = await this.repo.queryActionCenterTasksPage({
        ...queryBase,
        exclusiveStartKey: exclusiveKey,
      });

      lastEvaluatedKey = page.lastEvaluatedKey;
      exclusiveKey = page.lastEvaluatedKey;
      rounds++;

      for (const record of page.items) {
        const classification = classificationInputFromMeta(record);
        const primary = deriveActionCenterSurfaceSection(classification, timeZone);
        if (!matchesActionCenterFilter(primary, classification, filter)) {
          continue;
        }
        const sectionOnCard =
          filter === SURFACE_SECTION.CARE_PLAN_CHECKLIST ? SURFACE_SECTION.CARE_PLAN_CHECKLIST : primary;
        collected.push(toActionCenterTaskCard(record, timeZone, Date.now(), sectionOnCard));
      }
    } while (
      collected.length < input.pageSize &&
      lastEvaluatedKey &&
      rounds < TASK_LIST_SURFACE_FILTER_MAX_ROUNDS
    );

    if (lastEvaluatedKey && rounds >= TASK_LIST_SURFACE_FILTER_MAX_ROUNDS) {
      this.log.warn({
        event: 'action_center_surface_filter_round_cap',
        message: 'surfaceSection filter hit max DynamoDB query rounds',
        organizationId: input.organizationId,
        patientId: input.patientId,
        surfaceSection: filter,
        rounds: TASK_LIST_SURFACE_FILTER_MAX_ROUNDS,
      });
    }

    return {
      patientId: input.patientId,
      ...(input.carePlanInstanceId ? { carePlanInstanceId: input.carePlanInstanceId } : {}),
      timezone: timeZone,
      surfaceSection: filter,
      items: sortActionCenterCardsByDue(collected).slice(0, input.pageSize),
      nextToken: encodeTaskHistoryCursor(lastEvaluatedKey),
    };
  }

  async getTaskStatusSummaryByCarePlan(
    input: GetTaskStatusSummaryInput,
  ): Promise<TaskStatusSummaryResult> {
    const records: TaskMetaDdbRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    let rounds = 0;

    do {
      const page = await this.repo.queryCarePlanTasksForSummaryPage({
        organizationId: input.organizationId,
        patientId: input.patientId,
        carePlanInstanceId: input.carePlanInstanceId,
        workflowStage: input.workflowStage,
        pageSize: TASK_LIST_MAX_PAGE_SIZE,
        exclusiveStartKey,
      });

      records.push(...page.items);
      exclusiveStartKey = page.lastEvaluatedKey;
      rounds++;
    } while (exclusiveStartKey && rounds < TASK_STATUS_SUMMARY_MAX_QUERY_ROUNDS);

    if (exclusiveStartKey && rounds >= TASK_STATUS_SUMMARY_MAX_QUERY_ROUNDS) {
      this.log.warn({
        event: 'task_status_summary_query_round_cap',
        message: 'Care plan task status summary hit max DynamoDB query rounds',
        organizationId: input.organizationId,
        patientId: input.patientId,
        carePlanInstanceId: input.carePlanInstanceId,
        rounds: TASK_STATUS_SUMMARY_MAX_QUERY_ROUNDS,
      });
    }

    return aggregateTaskStatusSummary(records, {
      orgId: input.organizationId,
      patientId: input.patientId,
      carePlanInstanceId: input.carePlanInstanceId,
      workflowStage: input.workflowStage,
    });
  }

  private appendActionCenterRecord(
    sections: Record<SurfaceSection, ActionCenterTaskCard[]>,
    record: TaskMetaDdbRecord,
    timeZone: string,
  ): void {
    const classification = classificationInputFromMeta(record);
    const primary = deriveActionCenterSurfaceSection(classification, timeZone);
    sections[primary].push(toActionCenterTaskCard(record, timeZone, Date.now(), primary));
    if (isCarePlanChecklistEligible(classification, primary)) {
      sections[SURFACE_SECTION.CARE_PLAN_CHECKLIST].push(
        toActionCenterTaskCard(record, timeZone, Date.now(), SURFACE_SECTION.CARE_PLAN_CHECKLIST),
      );
    }
  }

  async listStaffTasks(input: ListStaffTasksInput): Promise<PaginatedRuntimeTaskCards> {
    const exclusiveStartKey = input.nextToken?.trim()
      ? decodeTaskHistoryCursor(input.nextToken)
      : undefined;

    const page = await this.repo.queryStaffTasksPage({
      organizationId: input.organizationId,
      staffUserId: input.staffUserId,
      patientId: input.patientId,
      carePlanInstanceId: input.carePlanInstanceId,
      currentState: input.currentState,
      excludeTerminalStates: input.currentState == null,
      pageSize: input.pageSize,
      exclusiveStartKey,
    });

    return {
      items: sortRuntimeTaskCardsByDue(page.items.map((r) => toRuntimeTaskCard(r))),
      nextToken: encodeTaskHistoryCursor(page.lastEvaluatedKey),
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
      const normalizedLinkage = prepareAssignedToTypeInput({ ...linkage });

      const taskInput: CreateCarePlanTaskRequest = {
        organizationId: payload.organizationId,
        createdBy: payload.createdBy,
        patientId: payload.patientId,
        patientDisplayName: payload.patientDisplayName,
        carePlanInstanceId: payload.carePlanInstanceId,
        taskGenerationTrigger: payload.taskGenerationTrigger,
        workflowStage: payload.workflowStage,
        ...normalizedLinkage,
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

function sortRuntimeTaskCardsByDue(
  items: ReturnType<typeof toRuntimeTaskCard>[],
): ReturnType<typeof toRuntimeTaskCard>[] {
  return [...items].sort((a, b) => {
    const aDue = a.dueWindowStart ?? Number.MAX_SAFE_INTEGER;
    const bDue = b.dueWindowStart ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
}

function sortActionCenterCardsByDue(items: ActionCenterTaskCard[]): ActionCenterTaskCard[] {
  return sortRuntimeTaskCardsByDue(items) as ActionCenterTaskCard[];
}

function classificationInputFromMeta(record: TaskMetaDdbRecord) {
  return {
    currentState: record.currentState,
    dueWindowStart: record.dueWindowStart,
    dueWindowEnd: record.dueWindowEnd,
    displayAsChecklistItem: record.displayAsChecklistItem,
  };
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
