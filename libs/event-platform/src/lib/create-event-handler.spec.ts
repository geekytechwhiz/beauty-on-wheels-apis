/**
 * @jest-environment node
 */
import { z } from 'zod';

import { BaseError } from '@api-hub/utils';

import type { IdempotencyStrategy } from '../core/idempotency/idempotency-strategy';
import type { IdempotencyContext, IdempotencyResult } from '../core/idempotency/types';
import type { EventTransformer } from '../core/realtime/interfaces/event-transformer.interface';
import type { RealtimePublisher } from '../core/realtime/interfaces/realtime-publisher.interface';
import type { RealtimeAggregationPublisher } from '../core/realtime/publishers/realtime-aggregation.publisher';
import type { RecipientResolver } from '../core/realtime/interfaces/recipient-resolver.interface';
import type { RealtimeMessage } from '../core/realtime/types/realtime-message.type';
import type { LambdaInvocationContext } from '@api-hub/observability';

import { defineEvent } from '../core/schema/define-event';
import { createEventHandler } from './create-event-handler';

const lambdaContext: LambdaInvocationContext = {
  awsRequestId: 'req-test-eb-1',
  getRemainingTimeInMillis: () => 300_000,
};

const ThresholdSchema = defineEvent(
  z.object({
    patientId: z.string(),
    organizationId: z.string(),
    metric: z.string(),
    currentValue: z.number(),
    threshold: z.number(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    triggeredAt: z.string(),
  }),
  {
    eventType: 'Threshold.Breach.v1',
    eventVersion: '1.0.0',
    source: 'monitoring-service',
    transport: 'eventbridge',
  },
);

describe('createEventHandler', () => {
  it('maps EventBridge detail payloads and processes successfully', async () => {
    const handler = createEventHandler({
      operation: 'threshold.breach',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          schema: ThresholdSchema,
          handler: async (event) => {
            expect(event.patientId).toBe('p1');
            expect(event.meta.correlationId).toBe('corr-1');
          },
        },
      ],
    });

    await handler(
      {
        source: 'monitoring-service',
        'detail-type': 'Threshold.Breach.v1',
        detail: {
          eventId: 'evt-1',
          eventType: 'Threshold.Breach.v1',
          eventVersion: '1.0.0',
          timestamp: '2026-01-01T00:00:00.000Z',
          source: 'monitoring-service',
          idempotencyKey: 'idem-1',
          payload: {
            patientId: 'p1',
            organizationId: 'org-1',
            metric: 'hr',
            currentValue: 120,
            threshold: 100,
            severity: 'HIGH',
            triggeredAt: '2026-01-01T00:00:00.000Z',
          },
          meta: { correlationId: 'corr-1' },
        },
      },
      lambdaContext,
    );
  });

  it('throws when transport retry is required for EventBridge invocations', async () => {
    const handler = createEventHandler({
      operation: 'threshold.breach',
      consumer: {
        retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
        dlq: { enabled: false },
      },
      events: [
        {
          schema: ThresholdSchema,
          handler: async () => {
            throw new Error('handler failed');
          },
        },
      ],
    });

    await expect(
      handler(
        {
          source: 'monitoring-service',
          'detail-type': 'Threshold.Breach.v1',
          detail: {
            eventId: 'evt-2',
            eventType: 'Threshold.Breach.v1',
            eventVersion: '1.0.0',
            timestamp: '2026-01-01T00:00:00.000Z',
            source: 'monitoring-service',
            idempotencyKey: 'idem-2',
            payload: {
              patientId: 'p1',
              organizationId: 'org-1',
              metric: 'hr',
              currentValue: 120,
              threshold: 100,
              severity: 'HIGH',
              triggeredAt: '2026-01-01T00:00:00.000Z',
            },
            meta: { correlationId: 'corr-2' },
          },
        },
        lambdaContext,
      ),
    ).rejects.toBeInstanceOf(BaseError);
  });

  describe('realtime', () => {
    const ebDetail = {
      eventId: 'evt-rt-1',
      eventType: 'Threshold.Breach.v1',
      eventVersion: '1.0.0',
      timestamp: '2026-01-01T00:00:00.000Z',
      source: 'monitoring-service',
      idempotencyKey: 'idem-rt-1',
      payload: {
        patientId: 'p1',
        organizationId: 'org-1',
        metric: 'hr',
        currentValue: 120,
        threshold: 100,
        severity: 'HIGH' as const,
        triggeredAt: '2026-01-01T00:00:00.000Z',
      },
      meta: { correlationId: 'corr-rt-1' },
    };

    const ebEvent = {
      source: 'monitoring-service',
      'detail-type': 'Threshold.Breach.v1',
      detail: ebDetail,
    };

    const resolver: RecipientResolver = {
      resolve: async () => [{ userId: 'user-1' }],
    };

    const transformer: EventTransformer = {
      transform: (event) => ({
        channel: 'alerts',
        eventType: event.eventType,
        payload: { patientId: (event.payload as { patientId: string }).patientId },
        recipientIds: [],
      }),
    };

    it('publishes realtime messages after business handler success', async () => {
      const published: RealtimeMessage[] = [];
      const publisher: RealtimePublisher = {
        publish: async (messages) => {
          published.push(...messages);
        },
      };

      const handler = createEventHandler({
        operation: 'threshold.breach',
        consumer: {
          retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
          dlq: { enabled: false },
          realtimePublisher: publisher,
        },
        realtime: {
          enabled: true,
          resolver,
          transformer,
        },
        events: [
          {
            schema: ThresholdSchema,
            handler: async () => {
              /* success */
            },
          },
        ],
      });

      await handler(ebEvent, lambdaContext);

      expect(published).toHaveLength(1);
      expect(published[0]?.recipientIds).toEqual(['user-1']);
      expect(published[0]?.channel).toBe('alerts');
    });

    it('does not publish when business handler fails', async () => {
      const published: RealtimeMessage[] = [];
      const publisher: RealtimePublisher = {
        publish: async (messages) => {
          published.push(...messages);
        },
      };

      const handler = createEventHandler({
        operation: 'threshold.breach',
        consumer: {
          retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
          dlq: { enabled: false },
          realtimePublisher: publisher,
        },
        realtime: {
          enabled: true,
          resolver,
          transformer,
        },
        events: [
          {
            schema: ThresholdSchema,
            handler: async () => {
              throw new Error('handler failed');
            },
          },
        ],
      });

      await expect(handler(ebEvent, lambdaContext)).rejects.toBeInstanceOf(BaseError);
      expect(published).toHaveLength(0);
    });

    it('does not publish on duplicate idempotency without running handler', async () => {
      const published: RealtimeMessage[] = [];
      const publisher: RealtimePublisher = {
        publish: async (messages) => {
          published.push(...messages);
        },
      };

      const duplicateStrategy: IdempotencyStrategy = {
        before: async (_ctx: IdempotencyContext): Promise<IdempotencyResult> =>
          'DUPLICATE',
        afterSuccess: async () => {
          /* no-op */
        },
        onError: async () => {
          /* no-op */
        },
      };

      const businessHandler = jest.fn();

      const handler = createEventHandler({
        operation: 'threshold.breach',
        consumer: {
          retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
          dlq: { enabled: false },
          idempotencyStrategy: duplicateStrategy,
          realtimePublisher: publisher,
        },
        realtime: {
          enabled: true,
          resolver,
          transformer,
        },
        events: [
          {
            schema: ThresholdSchema,
            handler: businessHandler,
          },
        ],
      });

      await handler(ebEvent, lambdaContext);

      expect(businessHandler).not.toHaveBeenCalled();
      expect(published).toHaveLength(0);
    });

    it('does not fail event processing when realtime publish throws', async () => {
      const publisher: RealtimePublisher = {
        publish: async () => {
          throw new Error('publish failed');
        },
      };

      const handler = createEventHandler({
        operation: 'threshold.breach',
        consumer: {
          retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
          dlq: { enabled: false },
          realtimePublisher: publisher,
        },
        realtime: {
          enabled: true,
          resolver,
          transformer,
        },
        events: [
          {
            schema: ThresholdSchema,
            handler: async () => {
              /* success */
            },
          },
        ],
      });

      await expect(handler(ebEvent, lambdaContext)).resolves.toBeUndefined();
    });

    it('publishes to aggregation publisher when aggregate=true', async () => {
      const aggregated: unknown[] = [];
      const publisher: RealtimePublisher = { publish: jest.fn() };
      const aggregationPublisher: RealtimeAggregationPublisher = {
        publish: async (data) => {
          aggregated.push(data);
        },
      };

      const handler = createEventHandler({
        operation: 'threshold.breach',
        consumer: {
          retry: { maxAttempts: 1, strategy: 'fixed', delayMs: 1 },
          dlq: { enabled: false },
          realtimePublisher: publisher,
          realtimeAggregationPublisher: aggregationPublisher,
        },
        realtime: {
          enabled: true,
          aggregate: true,
          resolver,
          transformer,
        },
        events: [
          {
            schema: ThresholdSchema,
            handler: async () => {
              /* success */
            },
          },
        ],
      });

      await handler(ebEvent, lambdaContext);

      expect(aggregated).toHaveLength(1);
      expect(publisher.publish).not.toHaveBeenCalled();
    });
  });
});
