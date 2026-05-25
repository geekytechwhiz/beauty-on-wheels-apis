/** Temporary: set REALTIME_DEBUG_SOCKET=true on realtimeAggregation. Remove after E2E. */
export function isRealtimeSocketDebugEnabled(): boolean {
  return process.env.REALTIME_DEBUG_SOCKET === 'true';
}
