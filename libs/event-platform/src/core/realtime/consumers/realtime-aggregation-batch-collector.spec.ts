/**
 * @jest-environment node
 */
import { mergeBatchFailures } from './realtime-aggregation-batch-collector';

describe('mergeBatchFailures', () => {
  it('merges existing failures with additional message ids', () => {
    const result = mergeBatchFailures(
      { batchItemFailures: [{ itemIdentifier: 'mid-1' }] },
      ['mid-2', 'mid-3'],
    );

    expect(result.batchItemFailures).toEqual(
      expect.arrayContaining([
        { itemIdentifier: 'mid-1' },
        { itemIdentifier: 'mid-2' },
        { itemIdentifier: 'mid-3' },
      ]),
    );
    expect(result.batchItemFailures).toHaveLength(3);
  });

  it('deduplicates message ids', () => {
    const result = mergeBatchFailures(
      { batchItemFailures: [{ itemIdentifier: 'mid-1' }] },
      ['mid-1', 'mid-2'],
    );

    expect(result.batchItemFailures).toHaveLength(2);
  });
});
