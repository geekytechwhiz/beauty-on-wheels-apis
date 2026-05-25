import { getTracerForService } from '@api-hub/middleware';
import { createLogger, getLoggerContext } from '@api-hub/observability';

import type { RealtimePublisher } from '../interfaces/realtime-publisher.interface';
import { resolveSocketService } from '../services/resolve-socket-service';
import type { RealtimeMessage } from '../types/realtime-message.type';
import { deriveSocketDestinations } from '../utils/derive-socket-destinations';
import { isRealtimeSocketDebugEnabled } from '../utils/realtime-socket-debug';
import { traceRealtimeAsync } from '../utils/trace-realtime-async';

const logger = createLogger();
const tracer = getTracerForService('event-platform-realtime');

export class SocketRealtimePublisher implements RealtimePublisher {
 

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

    if (isRealtimeSocketDebugEnabled()) {
      logger.info({
        event: 'realtime.socket.debug',
        message: 'Realtime socket publish — derived destinations (debug)',
        correlationId,
        destinationsByMessage: destinationsByMessage.map(({ message, destinations }) => ({
          eventType: message.eventType,
          channel: message.channel,
          recipientIds: message.recipientIds,
          realtimeNotifyScope: message.payload.realtimeNotifyScope,
          organizationId: message.payload.organizationId,
          destinations,
          envelope: {
            type: message.eventType,
            payload: message.payload,
          },
        })),
        allDestinations: [...allDestinations],
      });
    }

    const run = async (): Promise<void> => {
      for (const { message, destinations } of destinationsByMessage) {
        const envelope = {
          type: message.eventType,
          payload: message.payload,
        };

        for (const destination of destinations) {
          try {
            await resolveSocketService().publish(destination, envelope, {
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
