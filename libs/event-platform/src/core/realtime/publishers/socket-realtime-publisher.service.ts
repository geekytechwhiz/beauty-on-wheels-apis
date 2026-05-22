import { createLogger, getLoggerContext } from '@api-hub/observability';
import { getTracerForService } from '@api-hub/middleware';

import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { SocketService } from '../interfaces/socket-service.interface';
import type { RealtimeMessage } from '../types/realtime-message.type';
import { deriveSocketDestinations } from '../utils/derive-socket-destinations';
import { traceRealtimeAsync } from '../utils/trace-realtime-async';

const logger = createLogger();
const tracer = getTracerForService('event-platform-realtime');

export class SocketRealtimePublisher implements RealtimePublisher {
  constructor(private readonly socketService: SocketService) {}

  async publish(messages: RealtimeMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const correlationId = getLoggerContext()?.correlationId;
    const destinationsByMessage = messages.map((message) => ({
      message,
      destinations: deriveSocketDestinations(message),
    }));

    const allDestinations = new Set(
      destinationsByMessage.flatMap((entry) => entry.destinations),
    );

    if (allDestinations.size === 0) {
      logger.info({
        event: 'realtime.socket.published',
        message: 'Realtime socket publish skipped — no destinations',
        recipientCount: 0,
        channelCount: 0,
        correlationId,
      });
      return;
    }

    const run = async (): Promise<void> => {
      for (const { message, destinations } of destinationsByMessage) {
        const envelope = {
          type: message.eventType,
          payload: message.payload,
        };

        for (const destination of destinations) {
          try {
            await this.socketService.publish(destination, envelope, {
              correlationId,
              eventType: message.eventType,
            });
          } catch (error) {
            logger.warn({
              event: 'realtime.socket.destination_failed',
              message: 'Realtime socket destination publish failed',
              destination,
              eventType: message.eventType,
              correlationId,
              error,
            });
          }
        }
      }

      const recipientCount = messages.reduce(
        (sum, m) => sum + m.recipientIds.length,
        0,
      );

      logger.info({
        event: 'realtime.socket.published',
        message: 'Realtime socket published',
        recipientCount,
        channelCount: allDestinations.size,
        eventType: messages[0]?.eventType,
        correlationId,
      });
    };

    await traceRealtimeAsync(tracer, 'SocketRealtimePublisher.publish', run);
  }
}
