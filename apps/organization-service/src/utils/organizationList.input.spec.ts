import { describe, expect, it } from '@jest/globals';
import { validateOrganizationListPost } from '../validation/request.validators';

describe('validateOrganizationListPost pagination input', () => {
  it('accepts lastEvaluatedKey from query string when POST body is empty', () => {
    const token =
      'eyJzayI6Ik9SR19ERVRBSUxTIiwiZ3NpMXBrIjoiT1JHX0xJU1QiLCJwayI6Ik9SRyNtbGtwcmdmdzc5OWI3OGMzIiwiZ3NpMXNrIjoiT1JHI21sa3ByZ2Z3Nzk5Yjc4YzMifQ==';
    const req: any = {
      event: { httpMethod: 'POST' },
      params: { lastEvaluatedKey: token, limit: '5' },
      body: undefined,
    };

    validateOrganizationListPost(req);

    expect(req.body.lastEvaluatedKey).toBe(token);
    expect(req.body.limit).toBe(5);
  });

  it('prefers POST body values over query string', () => {
    const req: any = {
      event: { httpMethod: 'POST' },
      params: { limit: '10', lastEvaluatedKey: 'from-query' },
      body: { limit: 3, lastEvaluatedKey: 'from-body' },
    };

    validateOrganizationListPost(req);

    expect(req.body.limit).toBe(3);
    expect(req.body.lastEvaluatedKey).toBe('from-body');
  });
});
