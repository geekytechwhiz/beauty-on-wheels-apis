
import {
    configureEventPlatform,
    EventBridgeAdapter
} from '@api-hub/event-platform';

let configured = false;

export function configureEventRuntime(): void {
  if (configured) {
    return;
  }

  configureEventPlatform({
    transport: 'eventbridge',
    serviceName: 'alert-service',

    publishers: {
      eventbridge: new EventBridgeAdapter(
        {
          eventBusName: process.env.ALERT_EVENT_BUS_NAME!, 
          source: 'alert-service',
        } 
       ),
    },
  });

  configured = true;
}