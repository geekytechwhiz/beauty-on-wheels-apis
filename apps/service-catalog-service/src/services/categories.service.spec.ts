import { ConflictError, LambdaRequest } from '@api-hub/utils';

import { CategoriesService } from './categories.service';
import { CategoriesRepository } from '../repositories/categories.repository';
import { CategoryEntity } from '../utils/types/catalog-domain.types';

function request(partial: Record<string, unknown> = {}): LambdaRequest {
  return {
    params: {},
    body: {},
    context: {},
    ...partial,
  } as unknown as LambdaRequest;
}

function category(): CategoryEntity {
  return {
    PK: 'CAT#cat-1',
    SK: 'META',
    entityType: 'CATEGORY',
    categoryId: 'cat-1',
    name: 'Wash',
    displayOrder: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CategoriesService', () => {
  const repository = {
    findById: jest.fn(),
    countServices: jest.fn(),
    countActiveServices: jest.fn(),
    deleteCategory: jest.fn(),
    listCategories: jest.fn(),
  };

  const service = new CategoriesService(repository as unknown as CategoriesRepository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the DynamoDB service count', async () => {
    repository.listCategories.mockResolvedValue({ items: [category()] });
    repository.countServices.mockResolvedValue(3);

    const result = await service.getcategories(request());

    expect(result.items[0].serviceCount).toBe(3);
  });

  it('rejects delete when the category contains services', async () => {
    repository.findById.mockResolvedValue(category());
    repository.countServices.mockResolvedValue(3);

    await expect(
      service.deletecategoryid(request({ params: { categoryId: 'cat-1' } })),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(repository.deleteCategory).not.toHaveBeenCalled();
  });

  it('deletes an empty category', async () => {
    repository.findById.mockResolvedValue(category());
    repository.countServices.mockResolvedValue(0);
    repository.deleteCategory.mockResolvedValue(undefined);

    await expect(
      service.deletecategoryid(request({ params: { categoryId: 'cat-1' } })),
    ).resolves.toEqual({ deleted: true, categoryId: 'cat-1' });
  });
});
