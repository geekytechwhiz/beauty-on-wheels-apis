import { handler } from './retry-alert.consumer';

describe('retry-alert.consumer', () => {
  it('resolves without error (placeholder handler)', async () => {
    await expect(handler()).resolves.toBeUndefined();
  });
});
