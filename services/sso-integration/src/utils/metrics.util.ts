import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const namespace = 'SSOIntegration/HMS';
const cw = new CloudWatchClient({});

/**
 * Emit a count metric for observability. No-op if PutMetricData fails (e.g. missing IAM).
 */
export async function emitMetric(
  name: string,
  value: number,
  unit: 'Count' | 'None' = 'Count',
  dimensions?: Record<string, string>,
): Promise<void> {
  const dims = dimensions
    ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
    : undefined;
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: [
          {
            MetricName: name,
            Value: value,
            Unit: unit,
            Dimensions: dims,
            Timestamp: new Date(),
          },
        ],
      }),
    );
  } catch {
    // Best-effort; do not fail the request
  }
}

export const MetricNames = {
  HMS_FETCH_FAILURES: 'HmsFetchFailures',
  HMS_FETCH_SUCCESS: 'HmsFetchSuccess',
  SCHEDULE_CREATION_FAILURES: 'ScheduleCreationFailures',
  SCHEDULE_CREATION_SUCCESS: 'ScheduleCreationSuccess',
} as const;
