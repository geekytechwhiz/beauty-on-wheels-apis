import { DlqConfig } from './dlq-config';
import { buildDlqMessage } from '../../utils/dlq.utils';
// import { buildDlqMessage } from './dlq.utils';

export async function handleDlq(params: {
  dlq: DlqConfig;
  event: unknown;
  error: unknown;
  retryCount?: number;
}) {
  const { dlq, event, error, retryCount } = params;

  if (!dlq.enabled || !dlq.strategy) return;

  let message = buildDlqMessage({ event, error, retryCount });

  if (dlq.enrich) {
    const extra = dlq.enrich({ event, error, retryCount });

    message = {
      ...message,
      ...extra,
      metadata: {
        ...message.metadata,
        ...(extra as any)?.metadata,
      },
    };
  }

  await dlq.strategy?.send(message);
}