export interface ConnectionStore {
  registerSubscriptions(input: {
    connectionId: string;
    destinations: string[];
  }): Promise<void>;

  unregisterConnection(connectionId: string): Promise<void>;

  resolveConnections(destination: string): Promise<string[]>;
}
