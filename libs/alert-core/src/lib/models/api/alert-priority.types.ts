import type { PriorityBand } from '../types/priority-band.type';

export interface PriorityInput {
  alertIds: string[];
  priority: PriorityBand;
  performedByUserId?: string;
  performedByDisplayName?: string;
}

export interface PriorityResult {
  // Intentionally empty result shape; mutation endpoints return ids/results at the HTTP layer.
  // (Kept as an interface for forward-compatible extension.)
}

