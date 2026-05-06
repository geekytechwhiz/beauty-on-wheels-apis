import { AlertState } from '../types/alert-state.type';
import { PriorityBand } from '../types/priority-band.type';

export interface AlertListItem {
  alertId: string;
  patientId: string;

  priority: PriorityBand;
  alertState: AlertState;

  triggerSummary: string;
  /** Unix epoch milliseconds (UTC). */
  triggerTimestamp: number;

  assignedToUserId?: string;

  /** Unix epoch milliseconds (UTC). */
  slaDueAt?: number;
  slaBreachIndicator?: boolean;
}
