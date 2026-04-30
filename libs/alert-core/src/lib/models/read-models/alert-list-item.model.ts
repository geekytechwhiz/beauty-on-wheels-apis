import { AlertState } from '../types/alert-state.type';
import { PriorityBand } from '../types/priority-band.type';

export interface AlertListItem {
  alertId: string;
  patientId: string;

  priority: PriorityBand;
  alertState: AlertState;

  triggerSummary: string;
  triggerTimestamp: string;

  assignedToUserId?: string;

  slaDueAt?: string;
  slaBreachIndicator?: boolean;
}
