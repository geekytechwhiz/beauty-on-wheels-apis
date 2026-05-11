/**
 * EventBridge PutEvents wiring (repo pattern: {@link EventBridgeClient} with `region`).
 */
export type EventBridgeAdapterConfig = { 
  eventBusName: string;  
  source: string; 
};
