/**
 * UI-friendly WebSocket message format.
 * Never expose raw domain models.
 */
export interface WebSocketEvent<T = Record<string, unknown>> {
  type: string;
  entityId: string;
  timestamp: string;
  payload: T;
}

export function createWebSocketEvent<T>(
  type: string,
  entityId: string,
  payload: T
): WebSocketEvent<T> {
  return {
    type,
    entityId,
    timestamp: new Date().toISOString(),
    payload,
  };
}
