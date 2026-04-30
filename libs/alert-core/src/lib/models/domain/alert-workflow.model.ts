import { AlertState } from '../types/alert-state.type';

export interface AlertWorkflow {
  alertState: AlertState;
  statusUpdatedAt: string;
  statusUpdatedBy?: string;

  closureComment?: string;
  resolutionCode?: string;
  dismissReason?: string;
}
