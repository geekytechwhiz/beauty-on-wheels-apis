const mockExecute = jest.fn();

jest.mock('../runtime', () => ({
  getTemplateRuntime: () => ({
    processTemplateOutboxUseCase: {
      execute: mockExecute,
    },
  }),
}));

import { main } from './processOutbox';

describe('processOutbox handler', () => {
  const originalIsOffline = process.env.IS_OFFLINE;
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    mockExecute.mockReset();
    consoleWarnSpy.mockClear();
    process.env.IS_OFFLINE = originalIsOffline;
  });

  afterAll(() => {
    process.env.IS_OFFLINE = originalIsOffline;
    consoleWarnSpy.mockRestore();
  });

  it('returns the use case result when processing succeeds', async () => {
    mockExecute.mockResolvedValue({ processed: 3 });

    await expect(main()).resolves.toEqual({ processed: 3 });
  });

  it('skips missing outbox resources while running offline', async () => {
    process.env.IS_OFFLINE = 'true';

    const error = new Error('missing resource');
    error.name = 'ResourceNotFoundException';
    mockExecute.mockRejectedValue(error);

    await expect(main()).resolves.toEqual({ processed: 0, skipped: true });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Skipping processTemplateOutbox in serverless-offline because the template outbox table or GSI2 is not available yet.',
    );
  });

  it('rethrows missing resources outside offline mode', async () => {
    process.env.IS_OFFLINE = 'false';

    const error = new Error('missing resource');
    error.name = 'ResourceNotFoundException';
    mockExecute.mockRejectedValue(error);

    await expect(main()).rejects.toThrow(error);
  });
});
