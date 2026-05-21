export type SocketPublishContext = {
  correlationId?: string;
  eventType?: string;
};

export interface SocketService {
  publish(
    destination: string,
    payload: Record<string, unknown>,
    context?: SocketPublishContext,
  ): Promise<void>;
}
