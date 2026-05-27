/** DynamoDB item: one WebSocket connection subscribed to one destination key. */
export type SocketConnectionRecord = {
  pk: string;
  sk: string;
  destination: string;
  connectionId: string;
  connectedAt: string;
  ttl: number;
};

export type RegisterConnectionSubscriptionInput = {
  connectionId: string;
  destinations: string[];
};
