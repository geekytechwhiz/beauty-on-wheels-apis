/**
 * Thrown from DynamoDB stream `mapRawToBaseEvent` when a record does not match any route.
 * {@link processSingle} maps this to a successful ack (no partial batch failure noise).
 */
export class StreamRecordFilteredError extends Error {
  readonly code = 'STREAM_RECORD_FILTERED';

  constructor(message = 'DynamoDB stream record did not match any configured route') {
    super(message);
    this.name = 'StreamRecordFilteredError';
  }
}
