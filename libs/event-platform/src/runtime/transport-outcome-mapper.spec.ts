/**
 * @jest-environment node
 */
import { mapSingleTransportOutcome, TransportRetryRequiredError } from './transport-outcome-mapper';

describe('transport-outcome-mapper', () => {
  it('throws when single-transport consumer needs transport retry', () => {
    expect(() =>
      mapSingleTransportOutcome(
        { outcome: 'needs_transport_retry', error: new Error('boom') },
        { supportsPartialBatch: false },
      ),
    ).toThrow(TransportRetryRequiredError);
  });

  it('allows ack outcomes for single-transport consumers', () => {
    expect(() =>
      mapSingleTransportOutcome(
        { outcome: 'success' },
        { supportsPartialBatch: false },
      ),
    ).not.toThrow();
  });
});
