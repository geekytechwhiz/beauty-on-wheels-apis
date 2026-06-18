import type { LambdaRequest } from '@api-hub/utils';
import { BaseError } from '@api-hub/utils';
import {
  TaskService,
  createMonitoringActionPayloadFromHttpBody,
  createRuntimeTaskPayloadFromHttpBody,
  generateCarePlanTasksPayloadFromHttpBody,
  normalizeTaskServiceError,
  toRuntimeTaskCard,
} from '@api-hub/task-core';

import type {
  ValidatedCreateMonitoringAction,
  ValidatedCreateRuntimeTask,
  ValidatedGenerateCarePlanTasks,
  ValidatedGetRuntimeTask,
  ValidatedGetActionCenterItems,
  ValidatedGetRuntimeTaskHistory,
  ValidatedGetStaffTasks,
  ValidatedGetTasks,
  ValidatedGetTaskStatusSummary,
  ValidatedUpdateAssignedStaff,
  ValidatedUpdateReminderSettings,
  ValidatedUpdateRuntimeTask,
  ValidatedUpdateTaskState,
} from '../validators/request.validators';

let taskService: TaskService | undefined;
function getTaskService(): TaskService {
  if (!taskService) taskService = new TaskService();
  return taskService;
}

let ctrl: TaskHttpController | undefined;

export class TaskHttpController {
  private readonly svc = getTaskService();

  async handleCreateMonitoringAction(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedCreateMonitoringAction?: ValidatedCreateMonitoringAction })
      .validatedCreateMonitoringAction;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const payload = createMonitoringActionPayloadFromHttpBody(validated.orgId, validated.body);
      const { record, outcome } = await this.svc.createMonitoringAction(payload);
      const task = toRuntimeTaskCard(record);

      return {
        runtimeTaskInstanceId: record.runtimeTaskInstanceId,
        outcome,
        task,
      };
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_monitoring_create_service_error',
      });
    }
  }

  async handleCreateRuntimeTask(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedCreateRuntimeTask?: ValidatedCreateRuntimeTask })
      .validatedCreateRuntimeTask;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const payload = createRuntimeTaskPayloadFromHttpBody(
        validated.orgId,
        validated.body,
        validated.createdBy,
      );
      const { record } = await this.svc.createRuntimeTask(payload);
      const task = toRuntimeTaskCard(record);

      return {
        runtimeTaskInstanceId: record.runtimeTaskInstanceId,
        task,
      };
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_create_service_error',
      });
    }
  }

  async handleGetRuntimeTask(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedGetRuntimeTask?: ValidatedGetRuntimeTask })
      .validatedGetRuntimeTask;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getRuntimeTaskDetail({
        organizationId: validated.orgId,
        runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
        includeRelated: validated.includeRelated,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_get_service_error',
      });
    }
  }

  async handleUpdateAssignedStaff(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & {
      validatedUpdateAssignedStaff?: ValidatedUpdateAssignedStaff;
    }).validatedUpdateAssignedStaff;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.reassignAssignedStaff({
        organizationId: validated.orgId,
        runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
        actorId: validated.body.actorId,
        assignedToStaffId: validated.body.assignedToStaffId,
        assignedToStaffDisplayName: validated.body.assignedToStaffDisplayName,
        reason: validated.body.reason,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_reassign_staff_service_error',
      });
    }
  }

  async handleGetTasks(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedGetTasks?: ValidatedGetTasks }).validatedGetTasks;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.listPatientTasks({
        organizationId: validated.orgId,
        patientId: validated.patientId,
        staffUserId: validated.staffUserId,
        carePlanInstanceId: validated.carePlanInstanceId,
        workflowStage: validated.workflowStage,
        currentState: validated.currentState,
        pageSize: validated.pageSize,
        nextToken: validated.nextToken,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_list_service_error',
      });
    }
  }

  async handleGetStaffTasks(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedGetStaffTasks?: ValidatedGetStaffTasks })
      .validatedGetStaffTasks;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.listStaffTasks({
        organizationId: validated.orgId,
        staffUserId: validated.staffUserId,
        patientId: validated.patientId,
        carePlanInstanceId: validated.carePlanInstanceId,
        currentState: validated.currentState,
        pageSize: validated.pageSize,
        nextToken: validated.nextToken,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_staff_list_service_error',
      });
    }
  }

  async handleGetActionCenterItems(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & {
      validatedGetActionCenterItems?: ValidatedGetActionCenterItems;
    }).validatedGetActionCenterItems;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.listActionCenterItems({
        organizationId: validated.orgId,
        patientId: validated.patientId,
        carePlanInstanceId: validated.carePlanInstanceId,
        workflowStage: validated.workflowStage,
        surfaceSection: validated.surfaceSection,
        timezone: validated.timezone,
        pageSize: validated.pageSize,
        nextToken: validated.nextToken,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_action_center_list_service_error',
      });
    }
  }

  async handleGetRuntimeTaskHistory(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & {
      validatedGetRuntimeTaskHistory?: ValidatedGetRuntimeTaskHistory;
    }).validatedGetRuntimeTaskHistory;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getRuntimeTaskHistory({
        organizationId: validated.orgId,
        runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
        pageSize: validated.pageSize,
        nextToken: validated.nextToken,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_history_get_service_error',
      });
    }
  }

  async handleGenerateCarePlanTasks(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedGenerateCarePlanTasks?: ValidatedGenerateCarePlanTasks })
      .validatedGenerateCarePlanTasks;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const payload = generateCarePlanTasksPayloadFromHttpBody(
        validated.orgId,
        validated.body,
        validated.createdBy,
      );
      return await this.svc.generateCarePlanTasks(payload);
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_care_plan_generate_service_error',
      });
    }
  }

  async handleUpdateTaskState(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & { validatedUpdateTaskState?: ValidatedUpdateTaskState })
      .validatedUpdateTaskState;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.updateTaskState(
        {
          organizationId: validated.orgId,
          runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
          action: validated.body.action,
          actorId: validated.body.actorId,
          actorType: validated.body.actorType,
          expectedCurrentState: validated.body.expectedCurrentState,
          reason: validated.body.reason,
          evidencePayload: validated.body.evidencePayload,
        },
        { correlationId: req.context.correlationId },
      );
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_update_state_service_error',
      });
    }
  }

  async handleGetTaskStatusSummary(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & {
      validatedGetTaskStatusSummary?: ValidatedGetTaskStatusSummary;
    }).validatedGetTaskStatusSummary;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getTaskStatusSummaryByCarePlan({
        organizationId: validated.orgId,
        patientId: validated.patientId,
        carePlanInstanceId: validated.carePlanInstanceId,
        workflowStage: validated.workflowStage,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_care_plan_status_summary_service_error',
      });
    }
  }

  async handleUpdateRuntimeTask(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & {
      validatedUpdateRuntimeTask?: ValidatedUpdateRuntimeTask;
    }).validatedUpdateRuntimeTask;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.updateRuntimeTask({
        organizationId: validated.orgId,
        runtimeTaskInstanceId: validated.runtimeTaskInstanceId,
        actorId: validated.body.actorId,
        reason: validated.body.reason,
        patch: validated.patch,
      });
    } catch (err: unknown) {
      normalizeTaskServiceError(err, {
        logger: requestLogger,
        correlationId: req.context.correlationId,
        organizationId: validated.orgId,
        logEvent: 'task_runtime_update_metadata_service_error',
      });
    }
  }

  async handleUpdateReminderSettings(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }

    const validated = (req as LambdaRequest & {
      validatedUpdateReminderSettings?: ValidatedUpdateReminderSettings;
    }).validatedUpdateReminderSettings;
    if (!validated) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

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
        logger: requestLogger,
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
