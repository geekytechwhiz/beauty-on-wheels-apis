import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

import { applySesLifecycleBatch } from '../delivery/apply-ses-lifecycle.js';
import { getEmailDeliveryStore } from './composition.js';
import { PowertoolsEmailMetrics } from '../observability/email-metrics.js';
import type { EmailDeliveryStore } from '../idempotency/email-delivery-store.js';
import type { EmailMetrics } from '../observability/email-metrics.js';

const metrics = new PowertoolsEmailMetrics();

export function createEmailDeliveryHandler(deps?: {
  store?: EmailDeliveryStore;
  metrics?: EmailMetrics;
}) {
  const store = deps?.store ?? getEmailDeliveryStore();
  const deliveryMetrics = deps?.metrics ?? metrics;

  return async function handle(event: SQSEvent): Promise<SQSBatchResponse> {
    return applySesLifecycleBatch(event, store, deliveryMetrics);
  };
}

export const main = createEmailDeliveryHandler();
