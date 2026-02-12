import type { EventBridgeHandler } from 'aws-lambda';
import { main } from './labEvents.subscriber';
import * as realtimeService from '../services/realtime.service';

jest.mock('@api-hub/logger', () => ({
  createLogger: jest.fn(() => ({ child: () => ({}) })),
  createChildLogger: jest.fn(() => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  })),
  serializeError: jest.fn((e: unknown) => e),
}));

jest.mock('../services/realtime.service', () => ({
  deliverToOrg: jest.fn().mockResolvedValue(undefined),
}));

const deliverToOrgMock = realtimeService.deliverToOrg as jest.Mock;

function makeEvent(
  detailType: string,
  detail: Record<string, unknown>
): Parameters<EventBridgeHandler<string, unknown, void>>[0] {
  return {
    'detail-type': detailType,
    detail,
    id: 'evt-1',
    version: '0',
    account: '123',
    time: new Date().toISOString(),
    region: 'us-east-1',
    resources: [],
    source: 'test',
  } as Parameters<EventBridgeHandler<string, unknown, void>>[0];
}

describe('labEvents.subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips when orgId is missing', async () => {
    await main(
      makeEvent('LAB_REPORT_READY', { labOrderId: 'ord-1' })
    );
    expect(deliverToOrgMock).not.toHaveBeenCalled();
  });

  it('calls deliverToOrg with websocket event when orgId present', async () => {
    await main(
      makeEvent('LAB_REPORT_READY', {
        orgId: 'org-1',
        labOrderId: 'ord-1',
        status: 'READY',
      })
    );
    expect(deliverToOrgMock).toHaveBeenCalledTimes(1);
    const [orgId, wsEvent] = deliverToOrgMock.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(wsEvent).toMatchObject({
      payload: expect.objectContaining({
        status: 'READY',
        labOrderId: 'ord-1',
        reportReady: true,
      }),
    });
  });

  it('includes reportReady true for LAB_REPORT_READY', async () => {
    await main(
      makeEvent('LAB_REPORT_READY', { orgId: 'org-1', entityId: 'e1' })
    );
    const payload = deliverToOrgMock.mock.calls[0][1].payload;
    expect(payload.reportReady).toBe(true);
  });

  it('does not include reportReady for LAB_ORDER_STATUS_UPDATED', async () => {
    await main(
      makeEvent('LAB_ORDER_STATUS_UPDATED', { orgId: 'org-1', labOrderId: 'o1' })
    );
    const payload = deliverToOrgMock.mock.calls[0][1].payload;
    expect(payload).not.toHaveProperty('reportReady');
  });

  it('uses entityId as labOrderId when labOrderId missing', async () => {
    await main(
      makeEvent('LAB_SAMPLE_COLLECTED', { orgId: 'org-1', entityId: 'ent-1' })
    );
    const payload = deliverToOrgMock.mock.calls[0][1].payload;
    expect(payload.labOrderId).toBe('ent-1');
  });
});
