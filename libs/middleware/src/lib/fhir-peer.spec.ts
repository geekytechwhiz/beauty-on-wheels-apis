import type { LambdaRequest } from '@api-hub/utils';

import { isFhirValidationErrorLike, loadFhirPeer } from './fhir-peer';

describe('loadFhirPeer', () => {
  it('loads FHIR helper functions used by withApiHandler', async () => {
    const peer = await loadFhirPeer();

    expect(peer).not.toBeNull();
    expect(typeof peer?.isFhirEnabled).toBe('function');
    expect(typeof peer?.transformToFhirResponse).toBe('function');
    expect(typeof peer?.fhirValidationErrorResponse).toBe('function');
    expect(typeof peer?.isFhirValidationErrorLike).toBe('function');
    expect(typeof peer?.isFhirRequest).toBe('function');
    expect(typeof peer?.shouldTransformFhirRequest).toBe('function');
    expect(typeof peer?.transformFhirRequest).toBe('function');
  });

  it('caches the loaded peer across calls', async () => {
    const first = await loadFhirPeer();
    const second = await loadFhirPeer();

    expect(first).toBe(second);
  });

  it('detects FHIR negotiation via the peer', async () => {
    const peer = await loadFhirPeer();
    const req = {
      event: {
        headers: { Accept: 'application/fhir+json' },
      },
    } as unknown as LambdaRequest;

    expect(peer?.isFhirRequest?.(req)).toBe(true);
  });

  it('matches FhirValidationError shape without importing FHIR', () => {
    expect(
      isFhirValidationErrorLike({
        code: 'FHIR_VALIDATION_FAILED',
        statusCode: 422,
        issues: [],
      }),
    ).toBe(true);
    expect(isFhirValidationErrorLike(new Error('nope'))).toBe(false);
  });
});
