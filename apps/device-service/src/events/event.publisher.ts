import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'event-publisher' });
const eventBridge = new EventBridgeClient({ region: process.env.REGION || 'us-east-1' });

export interface DevicePairedEvent {
  eventType: 'Device.Paired';
  userId: string;
  organizationId: string;
  deviceId: string;
  configDeviceId: string;
  timestamp: number;
}

export interface DeviceDeletedEvent {
  eventType: 'Device.Deleted';
  userId: string;
  deviceId: string;
  configDeviceId?: string;
  timestamp: number;
}

export interface DeviceRecommendedEvent {
  eventType: 'Device.Recommended';
  patientUserId: string;
  doctorId: string;
  organizationId: string;
  deviceId: string;
  timestamp: number;
}

export interface OrganizationDeviceAddedEvent {
  eventType: 'Organization.DeviceAdded';
  organizationId: string;
  deviceId: string;
  addedBy?: string;
  timestamp: number;
}

export type DeviceEvent = DevicePairedEvent | DeviceDeletedEvent | DeviceRecommendedEvent | OrganizationDeviceAddedEvent;

export async function publishEvent(event: Deviceevent: any, correlationId?: string): Promise<void> {
  const logger = createChildLogger(baseLogger, { correlationId, eventType: event.eventType });
  const eventBusName = process.env.EVENT_BUS || 'device-service-bus-dev';

  try {
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'device-service',
            DetailType: event.eventType,
            Detail: JSON.stringify(event),
            EventBusName: eventBusName,
          },
        ],
      }),
    );
    logger.info({ event: 'event_published', eventType: event.eventType });
  } catch (err) {
    logger.error({ event: 'event_publish_failed', err: serializeError(err), eventType: event.eventType });
    // Don't throw - event publishing failures shouldn't break the main flow
  }
}
