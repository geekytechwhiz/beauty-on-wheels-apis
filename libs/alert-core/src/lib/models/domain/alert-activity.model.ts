import { BaseEntity } from '../base/base.entity';
import { AlertState } from '../types/alert-state.type';
import { PriorityBand } from '../types/priority-band.type';

export interface AlertActivity extends BaseEntity {
  activityId: string;
  alertId: string;

  activityType: string;
  activityTimestamp: string;

  performedBy: string;
  performedByDisplayName?: string;

  activityComment?: string;

  previousState?: AlertState;
  newState?: AlertState;

  previousPriority?: PriorityBand;
  newPriority?: PriorityBand;

  previousAssignee?: string;
  newAssignee?: string;

  evidencePayload?: Record<string, unknown>;
}
