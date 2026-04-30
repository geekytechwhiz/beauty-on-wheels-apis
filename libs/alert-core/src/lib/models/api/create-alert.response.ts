import { AlertState } from '../types/alert-state.type';

export interface CreateAlertResponse {
  alertId: string;
  groupingKey: string;
  alertState: AlertState;
  createdAt: string;
}
