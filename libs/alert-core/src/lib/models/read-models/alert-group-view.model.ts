import { AlertState } from '../types/alert-state.type';
import { PriorityBand } from '../types/priority-band.type';

export interface AlertGroupView {
  groupingKey: string;
  patientId: string;

  highestPriority: PriorityBand;

  openRecordCount: number;
  breachedRecordCount: number;

  latestAlertTimestamp: string;

  assignedToUserId?: string;

  alertState: AlertState;
}
