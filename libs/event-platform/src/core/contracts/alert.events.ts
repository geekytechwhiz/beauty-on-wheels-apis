export const ALERT_REALTIME_EVENT_VERSION = '1.0.0';

/** Middleware / logs `operation` — must end with `.processed` (lowercase; see `OperationName` in middleware-compose). */
export const ALERT_EVENT_OPERATIONS = {
  ON_CREATE_ALERT: 'alert-service.onCreateAlert.processed',
} as const;

export const ALERT_REALTIME_EVENTS = {
  TEAM_ALERTS_UPDATED: 'alert.team-alerts-updated.processed',
  MY_ALERTS_UPDATED: 'alert.my-alerts-updated.processed',
  ALERT_ASSIGNED: 'alert.assigned.processed',
  ALERT_CREATED: 'Alert.Created.Processed',
} as const;
