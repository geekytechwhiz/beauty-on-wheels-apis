import {
  ActorType,
  normalizeTaskServiceError,
  TaskService,
} from '@api-hub/task-core';

import { getTaskMetadataService } from '../services/task-metadata.service';
import type {
  ValidatedCreateMonitoringActionRequest,
  ValidatedCreateRuntimeTaskRequest,
  ValidatedGenerateCarePlanTasksRequest,
  ValidatedGetActionCenterItemsRequest,
  ValidatedGetRuntimeTaskHistoryRequest,
  ValidatedGetRuntimeTaskRequest,
  ValidatedGetStaffTasksRequest,
  ValidatedGetTasksRequest,
  ValidatedGetTaskStatusSummaryRequest,
  ValidatedUpdateAssignedStaffRequest,
  ValidatedUpdateReminderSettingsRequest,
  ValidatedUpdateRuntimeTaskRequest,
  ValidatedUpdateTaskStateRequest,
} from '../validators/request.validators';

let taskService: TaskService | undefined;
function getTaskService(): TaskService {
  if (!taskService) taskService = new TaskService();
  return taskService;
}

let ctrl: TaskHttpController | undefined;

export class TaskHttpController {
  private readonly svc = getTaskService();
  private readonly metaSvc = getTaskMetadataService();

  async handleCreateMonitoringAction(req: ValidatedCreateMonitoringActionRequest) {
    const { validatedCreateMonitoringAction: validated } = req;

    try {
      return await this.metaSvc.enrichCreateMonitoringActionAfterWrite(
        validated.authHeader,
        validated.body,
        () =>
          this.svc.createMonitoringAction({
            organizationId: validated.orgId,
            ...validated.body,
          }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_monitoring_create_service_error',
      });
    }
  }

  async handleCreateRuntimeTask(req: ValidatedCreateRuntimeTaskRequest) {
    const { validatedCreateRuntimeTask: validated } = req;

    try {
      return await this.metaSvc.enrichCreateRuntimeTaskAfterWrite(
        validated.authHeader,
        validated.body,
        () =>
          this.svc.createRuntimeTask({
            kind: 'http',
            organizationId: validated.orgId,
            body: validated.body,
            createdBy: validated.createdBy,
          }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_create_service_error',
      });
    }
  }

  async handleGetRuntimeTask(req: ValidatedGetRuntimeTaskRequest) {
    const { validatedGetRuntimeTask: validated } = req;

    try {
      return await this.metaSvc.enrichTaskInResultAfterRead(validated.authHeader, () =>
        this.svc.getRuntimeTaskDetail({
          organizationId: validated.orgId,
          runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
          includeRelated: validated.includeRelated,
        }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_get_service_error',
      });
    }
  }

  async handleUpdateAssignedStaff(req: ValidatedUpdateAssignedStaffRequest) {
    const { validatedUpdateAssignedStaff: validated } = req;

    try {
      return await this.metaSvc.enrichTaskInResultAfterRead(validated.authHeader, () =>
        this.svc.reassignAssignedStaff({
          organizationId: validated.orgId,
          runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
          actorId: validated.body.actorId,
          assignedToStaffId: validated.body.assignedToStaffId,
          assignedToStaffDisplayName: validated.body.assignedToStaffDisplayName,
          reason: validated.body.reason,
        }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_reassign_staff_service_error',
      });
    }
  }

  async handleGetTasks(req: ValidatedGetTasksRequest) {
    const { validatedGetTasks: validated } = req;

    try {
      return await this.metaSvc.enrichPatientTasksResultAfterRead(validated.authHeader, () =>
        this.svc.listPatientTasks({
          organizationId: validated.orgId,
          patientId: validated.patientId,
          staffUserId: validated.staffUserId,
          carePlanInstanceId: validated.carePlanInstanceId,
          workflowStage: validated.workflowStage,
          currentState: validated.currentState,
          pageSize: validated.pageSize,
          nextToken: validated.nextToken,
        }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_list_service_error',
      });
    }
  }

  async handleGetStaffTasks(req: ValidatedGetStaffTasksRequest) {
    const { validatedGetStaffTasks: validated } = req;

    try {
      return await this.metaSvc.enrichTaskListResultAfterRead(validated.authHeader, () =>
        this.svc.listStaffTasks({
          organizationId: validated.orgId,
          staffUserId: validated.staffUserId,
          patientId: validated.patientId,
          carePlanInstanceId: validated.carePlanInstanceId,
          currentState: validated.currentState,
          pageSize: validated.pageSize,
          nextToken: validated.nextToken,
        }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_staff_list_service_error',
      });
    }
  }

  async handleGetActionCenterItems(req: ValidatedGetActionCenterItemsRequest) {
    const { validatedGetActionCenterItems: validated } = req;

    try {
      return await this.metaSvc.enrichActionCenterResultAfterRead(validated.authHeader, () =>
        this.svc.listActionCenterItems({
          organizationId: validated.orgId,
          patientId: validated.patientId,
          carePlanInstanceId: validated.carePlanInstanceId,
          workflowStage: validated.workflowStage,
          surfaceSection: validated.surfaceSection,
          timezone: validated.timezone,
          pageSize: validated.pageSize,
          nextToken: validated.nextToken,
        }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_action_center_list_service_error',
      });
    }
  }

  async handleGetRuntimeTaskHistory(req: ValidatedGetRuntimeTaskHistoryRequest) {
    const { validatedGetRuntimeTaskHistory: validated } = req;

    try {
      return await this.svc.getRuntimeTaskHistory({
        organizationId: validated.orgId,
        runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
        pageSize: validated.pageSize,
        nextToken: validated.nextToken,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_history_get_service_error',
      });
    }
  }

  async handleGenerateCarePlanTasks(req: ValidatedGenerateCarePlanTasksRequest) {
    const { validatedGenerateCarePlanTasks: validated } = req;

    try {
      return await this.metaSvc.enrichGenerateCarePlanResults(
        validated.body,
        validated.authHeader,
        () =>
          this.svc.generateCarePlanTasks({
            organizationId: validated.orgId,
            ...validated.body,
          }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_care_plan_generate_service_error',
      });
    }
  }

  async handleUpdateTaskState(req: ValidatedUpdateTaskStateRequest) {
    const { validatedUpdateTaskState: validated } = req;

    try {
      return await this.svc.updateTaskState(
        {
          organizationId: validated.orgId,
          runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
          action: validated.body.action,
          actorId: validated.body.actorId,
          actorType: validated.body.actorType as ActorType,
          expectedCurrentState: validated.body.expectedCurrentState,
          reason: validated.body.reason,
          evidencePayload: validated.body.evidencePayload,
        },
        { correlationId: req.context.correlationId },
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_update_state_service_error',
      });
    }
  }

  async handleGetTaskStatusSummary(req: ValidatedGetTaskStatusSummaryRequest) {
    const { validatedGetTaskStatusSummary: validated } = req;

    try {
      return await this.metaSvc.enrichTaskStatusSummaryAfterRead(validated.authHeader, () =>
        this.svc.getTaskStatusSummaryByCarePlan({
          organizationId: validated.orgId,
          patientId: validated.patientId,
          carePlanInstanceId: validated.carePlanInstanceId,
          workflowStage: validated.workflowStage,
        }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_care_plan_status_summary_service_error',
      });
    }
  }

  async handleUpdateRuntimeTask(req: ValidatedUpdateRuntimeTaskRequest) {
    const { validatedUpdateRuntimeTask: validated } = req;

    try {
      return await this.metaSvc.enrichTaskInResultAfterWrite(
        'patchRuntimeTask',
        validated.patch,
        validated.authHeader,
        () =>
          this.svc.updateRuntimeTask({
            organizationId: validated.orgId,
            runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
            actorId: validated.body.actorId,
            reason: validated.body.reason,
            patch: validated.patch,
          }),
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_update_metadata_service_error',
      });
    }
  }

  async handleUpdateReminderSettings(req: ValidatedUpdateReminderSettingsRequest) {
    const { validatedUpdateReminderSettings: validated } = req;

    try {
      return await this.svc.updateReminderSettings(
        {
          organizationId: validated.orgId,
          runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
          actorId: validated.body.actorId,
          reminderEnabled: validated.body.reminderEnabled,
          reminderSettings: validated.body.reminderSettings,
          reason: validated.body.reason,
        },
        { correlationId: req.context.correlationId },
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: req.context.logger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_update_reminder_settings_service_error',
      });
    }
  }
}

export function getTaskHttpController(): TaskHttpController {
  if (!ctrl) ctrl = new TaskHttpController();
  return ctrl;
}
