import { INTERNAL_SERVICE_PRINCIPAL } from '@api-hub/authentication-core';
import type { LambdaRequest } from '@api-hub/utils';

import { handlePartnerManagerRead } from './internal-http';
import { getPartnerManagerReadService } from '../services/partner-manager-read.service';

jest.mock('../services/partner-manager-read.service', () => ({
  getPartnerManagerReadService: jest.fn(),
}));

jest.mock('@api-hub/middleware', () => ({
  withApiHandler: (_options: unknown, handler: (req: LambdaRequest) => Promise<unknown>) => handler,
}));

describe('handlePartnerManagerRead', () => {
  it('rejects non-internal callers', async () => {
    await expect(
      handlePartnerManagerRead({
        body: {},
        context: {
          authContext: {
            identityId: 'user-1',
            roles: ['VENDOR'],
            permissions: [],
            claims: {},
          },
        },
      } as LambdaRequest),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('delegates to PartnerManagerReadService for an internal principal', async () => {
    const read = jest.fn(async () => ({ timezone: 'Asia/Kolkata', days: [] }));
    (getPartnerManagerReadService as jest.Mock).mockReturnValue({ read });
    const body = { actor: { userId: 'u1', vendorId: 'v1' }, action: 'overview', query: {} };
    await expect(
      handlePartnerManagerRead({
        body,
        context: {
          authContext: {
            identityId: INTERNAL_SERVICE_PRINCIPAL,
            roles: ['INTERNAL'],
            permissions: [],
            claims: {},
          },
        },
      } as LambdaRequest),
    ).resolves.toEqual({ timezone: 'Asia/Kolkata', days: [] });
    expect(read).toHaveBeenCalledWith(body);
  });
});
