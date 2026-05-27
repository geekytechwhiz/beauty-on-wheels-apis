import { createLogger } from '@api-hub/observability';

import type { ConnectionStore } from '../interfaces/connection-store.interface';
import type { ConnectionResolver } from '../interfaces/connection-resolver.interface';

const logger = createLogger({ service: 'dynamodb-connection-resolver' });

export class DynamoDbConnectionResolver implements ConnectionResolver {
  constructor(private readonly store: ConnectionStore) {}

  async resolve(destination: string): Promise<string[]> {
    const connectionIds = await this.store.resolveConnections(destination);

    logger.info({
      event: 'realtime.connection.resolve',
      message: 'Resolved WebSocket connections for destination',
      destination,
      connectionCount: connectionIds.length,
    });

    return connectionIds;
  }
}
