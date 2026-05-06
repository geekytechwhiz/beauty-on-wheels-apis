import { AlertState } from '../types/alert-state.type';

export interface CreateAlertResponse {
  alertId: string;
  groupingKey: string;
  alertState: AlertState;
  /** Unix epoch milliseconds (UTC). */
  createdAt: number;
}
