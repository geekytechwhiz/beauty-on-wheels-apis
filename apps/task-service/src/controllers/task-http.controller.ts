import type { LambdaRequest } from '@api-hub/utils';
import { BaseError } from '@api-hub/utils';
import {
  TaskService,
  createMonitoringActionPayloadFromHttpBody,
  normalizeTaskServiceError,
  toRuntimeTaskCard,
} from '@api-hub/task-core';

import type { ValidatedCreateMonitoringAction } from '../validators/request.validators';

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
}

export function getTaskHttpController(): TaskHttpController {
  if (!ctrl) ctrl = new TaskHttpController();
  return ctrl;
}
