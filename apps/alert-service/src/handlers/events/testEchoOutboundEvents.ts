import type { EventBridgeEvent } from 'aws-lambda';

/** Dev: logs outbound alert-service bus events (e.g. Alert.Created.v1 after onCreateAlert). */
export async function main(event: EventBridgeEvent<string, unknown>): Promise<void> {
  console.log('ALERT_OUTBOUND_EVENT', JSON.stringify(event, null, 2));
}
