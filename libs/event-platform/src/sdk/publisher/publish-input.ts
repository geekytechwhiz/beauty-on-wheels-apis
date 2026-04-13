export type PublishInput<T = unknown> = {
  eventType: string;
  version: string;
  source: string;
  payload: T;
  correlationId?: string;
};
