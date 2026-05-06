import { AlertState } from '../types/alert-state.type';
import { PriorityBand } from '../types/priority-band.type';

export interface AlertGroupView {
  groupingKey: string;
  patientId: string;

  highestPriority: PriorityBand;

  openRecordCount: number;
  breachedRecordCount: number;

  /** Unix epoch milliseconds (UTC). */
  latestAlertTimestamp: number;

  assignedToUserId?: string;

  alertState: AlertState;
}
