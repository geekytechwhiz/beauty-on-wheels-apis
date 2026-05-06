/** Canonical alert workflow state values — use `ALERT_STATE.UNASSIGNED` etc. */
export const ALERT_STATE = {
  UNASSIGNED: 'UNASSIGNED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;

export type AlertState = (typeof ALERT_STATE)[keyof typeof ALERT_STATE];
