/** Middleware / logs `operation` — must end with `.processed` (see `OperationName` in middleware-compose). */
export const TASK_EVENT_OPERATIONS = {
  ON_MONITORING_ACTION_REQUESTED: 'task-service.onMonitoringActionRequested.processed',
  ON_SERVICE_FLOW_ACTIVATED: 'task-service.onServiceFlowActivated.processed',
  ON_CARE_PLAN_TASK_GENERATION_TRIGGERED: 'task-service.onCarePlanTaskGenerationTriggered.processed',
  ON_LINKED_SOURCE_OBJECT_COMPLETED: 'task-service.onLinkedSourceObjectCompleted.processed',
} as const;
