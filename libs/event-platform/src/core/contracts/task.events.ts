/** Middleware / logs `operation` — see `OperationName` in middleware-compose. */
export const TASK_REMINDER_STREAM_OPERATIONS = {
  REGISTER: 'task-service.reminder.register',
  CANCEL: 'task-service.reminder.cancel',
} as const;
