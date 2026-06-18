import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { publishEvent } from '../../../__tests__/mocks/event-platform.mock';

jest.mock('../bootstrap/event-runtime', () => ({
  configureEventRuntime: jest.fn(),
}));

const { publishOrgConfigPublishedEvent } = jest.requireActual<
  typeof import('./org-config-publisher')
>('./org-config-publisher');

const mockPublishEvent = jest.mocked(publishEvent) as jest.Mock<
  (schema: unknown, payload: unknown, options?: unknown) => Promise<void>
>;

describe('org-config-publisher', () => {
  const originalOffline = process.env.IS_OFFLINE;
  const originalStage = process.env.STAGE;
  const originalBypass = process.env.ORG_CONFIG_EVENT_PUBLISH_BYPASS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPublishEvent.mockResolvedValue(undefined);
    process.env.EVENT_BUS = 'organization-service-bus-test';
    delete process.env.IS_OFFLINE;
    delete process.env.ORG_CONFIG_EVENT_PUBLISH_BYPASS;
    process.env.STAGE = 'prd';
  });

  afterEach(() => {
    if (originalOffline === undefined) {
      delete process.env.IS_OFFLINE;
    } else {
      process.env.IS_OFFLINE = originalOffline;
    }
    if (originalStage === undefined) {
      delete process.env.STAGE;
    } else {
      process.env.STAGE = originalStage;
    }
    if (originalBypass === undefined) {
      delete process.env.ORG_CONFIG_EVENT_PUBLISH_BYPASS;
    } else {
      process.env.ORG_CONFIG_EVENT_PUBLISH_BYPASS = originalBypass;
    }
  });

  it('publishOrgConfigPublishedEvent publishes with tenant and correlation meta', async () => {
    const payload = {
      organizationId: 'org-1',
      orgConfigVersion: 5,
      changeType: 'update' as const,
      changedSections: ['enabledCategoryCodes'],
      publishedAt: '2026-06-10T12:00:00.000Z',
      publishedBy: 'user-1',
    };

    await publishOrgConfigPublishedEvent(payload, {
      organizationId: 'org-1',
      correlationId: 'corr-1',
    });

    expect(mockPublishEvent).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      expect.objectContaining({
        meta: {
          tenantId: 'org-1',
          correlationId: 'corr-1',
        },
      }),
    );
  });

  it('skips EventBridge publish when IS_OFFLINE is true', async () => {
    process.env.IS_OFFLINE = 'true';

    await publishOrgConfigPublishedEvent(
      {
        organizationId: 'org-1',
        orgConfigVersion: 1,
        changeType: 'initial',
        changedSections: [],
        publishedAt: '2026-06-10T12:00:00.000Z',
      },
      { organizationId: 'org-1', correlationId: 'corr-1' },
    );

    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('tolerates IAM failures in dev when not offline', async () => {
    process.env.STAGE = 'dev';
    const accessDenied = Object.assign(new Error('AccessDeniedException'), {
      name: 'AccessDeniedException',
    });
    mockPublishEvent.mockRejectedValueOnce(accessDenied);

    await expect(
      publishOrgConfigPublishedEvent(
        {
          organizationId: 'org-1',
          orgConfigVersion: 1,
          changeType: 'initial',
          changedSections: [],
          publishedAt: '2026-06-10T12:00:00.000Z',
        },
        { organizationId: 'org-1', correlationId: 'corr-1' },
      ),
    ).resolves.toBeUndefined();
  });

  it('propagates publish failures to the caller in prod-like env', async () => {
    mockPublishEvent.mockRejectedValueOnce(new Error('bus down'));

    await expect(
      publishOrgConfigPublishedEvent(
        {
          organizationId: 'org-1',
          orgConfigVersion: 1,
          changeType: 'initial',
          changedSections: [],
          publishedAt: '2026-06-10T12:00:00.000Z',
        },
        { organizationId: 'org-1', correlationId: 'corr-1' },
      ),
    ).rejects.toThrow('bus down');
  });
});
