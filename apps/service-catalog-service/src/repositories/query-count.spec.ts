jest.mock('@api-hub/utils', () => ({
  ddbDocClient: { send: jest.fn() },
  sendDoc: jest.fn(),
}));

import { sendDoc } from '@api-hub/utils';

import { queryCount } from './query-count';

const send = sendDoc as jest.Mock;

describe('queryCount', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('sums Count across pages and ignores Items length', async () => {
    send
      .mockResolvedValueOnce({
        Count: 2,
        Items: [{}, {}, {}, {}, {}],
        LastEvaluatedKey: { PK: 'CAT#a', SK: 'SERVICE#1' },
      })
      .mockResolvedValueOnce({
        Count: 1,
        Items: [],
      });

    const total = await queryCount({
      TableName: 'catalog-test',
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'entityType = :et',
      ExpressionAttributeValues: {
        ':pk': 'CAT#a',
        ':skPrefix': 'SERVICE#',
        ':et': 'SERVICE',
      },
    });

    expect(total).toBe(3);
    expect(send).toHaveBeenCalledTimes(2);
    const firstCommand = send.mock.calls[0][1];
    expect(firstCommand.input.Select).toBe('COUNT');
    expect(firstCommand.input.FilterExpression).toBe('entityType = :et');
  });
});
