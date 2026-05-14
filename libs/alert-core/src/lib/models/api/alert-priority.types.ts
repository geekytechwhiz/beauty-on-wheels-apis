import type { PriorityBand } from '../types/priority-band.type';

export interface PriorityInput {
  alertIds: string[];
  priority: PriorityBand;
  performedByUserId?: string;
  performedByDisplayName?: string;
} 

