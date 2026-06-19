const mockConfigureEventPlatform = jest.fn();

jest.mock('@api-hub/event-platform', () => ({
  configureEventPlatform: (...args: unknown[]) => mockConfigureEventPlatform(...args),
  EventBridgeAdapter: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  defineEvent: (schema: unknown) => schema,
  publishEvent: jest.fn(),
  onEvent: jest.fn(),
}));

describe('configureEventRuntime', () => {
  const originalBus = process.env.TASK_EVENT_BUS_NAME;

  beforeEach(() => {
    jest.resetModules();
    mockConfigureEventPlatform.mockClear();
    process.env.TASK_EVENT_BUS_NAME = 'test-task-bus';
  });

  afterAll(() => {
    process.env.TASK_EVENT_BUS_NAME = originalBus;
  });

  it('configures event platform once', async () => {
    const { configureEventRuntime } = await import('./event-runtime');
    configureEventRuntime();
    configureEventRuntime();
    expect(mockConfigureEventPlatform).toHaveBeenCalledTimes(1);
    expect(mockConfigureEventPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        publishers: expect.objectContaining({
          eventbridge: expect.anything(),
        }),
      }),
    );
  });
});
