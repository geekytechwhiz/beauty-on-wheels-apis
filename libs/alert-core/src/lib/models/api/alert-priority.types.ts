import type { PriorityBand } from '../types/priority-band.type';
import type { AlertPublishIntent } from '../events/alert-publish-intent';

export interface PriorityInput {
  alertIds: string[];
  priority: PriorityBand;
  performedByUserId?: string;
  performedByDisplayName?: string;
}

export interface PriorityResult {
  publishIntents: AlertPublishIntent[];
}


