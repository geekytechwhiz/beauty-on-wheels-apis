import type { LambdaRequest } from '@api-hub/utils';

import { isFhirRequest } from './is-fhir-request';

describe('isFhirRequest', () => {
  const baseReq = {
    event: { headers: {}, path: '/alerts/a1' },
    params: {},
    query: {},
    context: {},
  } as unknown as LambdaRequest;

  it('returns false for a standard JSON request', () => {
    expect(isFhirRequest(baseReq)).toBe(false);
  });

  it('returns true when Accept includes application/fhir+json', () => {
    const req = {
      ...baseReq,
      event: {
        ...baseReq.event,
        headers: { Accept: 'application/fhir+json' },
      },
    } as unknown as LambdaRequest;

    expect(isFhirRequest(req)).toBe(true);
  });

  it('returns true when Content-Type is application/fhir+json', () => {
    const req = {
      ...baseReq,
      event: {
        ...baseReq.event,
        headers: { 'Content-Type': 'application/fhir+json' },
      },
    } as unknown as LambdaRequest;

    expect(isFhirRequest(req)).toBe(true);
  });

  it('returns true when the path includes /fhir', () => {
    const req = {
      ...baseReq,
      event: {
        ...baseReq.event,
        path: '/fhir/Patient/123',
      },
    } as unknown as LambdaRequest;

    expect(isFhirRequest(req)).toBe(true);
  });

  it('returns true when _format query param requests FHIR', () => {
    const req = {
      ...baseReq,
      query: { _format: 'application/fhir+json' },
    } as unknown as LambdaRequest;

    expect(isFhirRequest(req)).toBe(true);
  });

  it('returns true when x-fhir-response header is true', () => {
    const req = {
      ...baseReq,
      event: {
        ...baseReq.event,
        headers: { 'x-fhir-response': 'true' },
      },
    } as unknown as LambdaRequest;

    expect(isFhirRequest(req)).toBe(true);
  });
});
