import type { SocketService } from '../interfaces/socket-service.interface';
import { ApiGatewaySocketService } from './api-gateway-socket.service';
import { resolveConnectionResolver } from './resolve-connection-resolver';

let cachedSocketService: SocketService | undefined;

export function isRealtimeSocketEnabled(): boolean {
  return process.env.REALTIME_SOCKET_ENABLED === 'true';
}

export function resolveSocketService(): SocketService {
  if (cachedSocketService) {
    return cachedSocketService;
  }

  cachedSocketService = new ApiGatewaySocketService({
    connectionResolver: resolveConnectionResolver(),
  });
  return cachedSocketService;
}

export function resetSocketServiceCache(): void {
  cachedSocketService = undefined;
}
