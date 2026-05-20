/**
 * @jest-environment node
 */
import { z } from 'zod';

import { BaseError } from '@api-hub/utils';

import { defineEvent } from '../core/schema/define-event';
import { createEventHandler } from './create-event-handler';
import type { Context } from 'aws-lambda';

const lambdaContext = {
  awsRequestId: 'req-test-eb-1',
  getRemainingTimeInMillis: () => 300_000,
} as unknown as Context;

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
});
