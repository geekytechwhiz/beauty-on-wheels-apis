jest.mock('../configs/env.config', () => ({
  env: {
    DYNAMODB_TABLE_NAME: 'catalog-test',
    SERVICE_NAME: 'service-catalog-service',
    LOG_LEVEL: 'info',
    EVENT_BUS_NAME: '',
    VENDOR_SERVICE_URL: '',
  },
}));

jest.mock('./query-count', () => ({
  queryCount: jest.fn(),
}));

import { queryCount } from './query-count';
import { CategoriesRepository } from './categories.repository';

const count = queryCount as jest.Mock;

describe('CategoriesRepository.countServices', () => {
  beforeEach(() => {
    count.mockReset();
  });

  it('counts SERVICE rows with Query Count, not an item array', async () => {
    count.mockResolvedValue(3);
    const repository = new CategoriesRepository();

    await expect(repository.countServices('cat-1')).resolves.toBe(3);

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'catalog-test',
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        FilterExpression: 'entityType = :et',
        ExpressionAttributeValues: expect.objectContaining({
          ':pk': 'CAT#cat-1',
          ':skPrefix': 'SERVICE#',
          ':et': 'SERVICE',
        }),
      }),
    );
    expect(count.mock.calls[0][0].Select).toBeUndefined();
  });
});
