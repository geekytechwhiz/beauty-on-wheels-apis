import {
  onEvent, 
} from '@api-hub/event-platform';
 
 
import { AlertStateChangedSchema } from './outbound/alert-state-changed.event'; 
export const handler = onEvent(
  AlertStateChangedSchema,

  async (event) => {
     
    // Ignore if state did not actually change
    if (event.payload.previousState === event.payload.currentState) {
     
      return;
    }

  
  },
);
 