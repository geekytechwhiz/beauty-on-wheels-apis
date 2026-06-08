import { handleError } from './error.middleware';

describe('handleError', () => {
  it('returns 422 for error-like validation rejections with broken prototype', async () => {
    const broken = Object.assign(Object.create(null), {
      name: 'Error',
      message: 'Invalid input: expected object, received undefined',
      code: 'VALIDATION_ERROR',
      statusCode: 422,
      details: [{ field: 'userInfo', message: 'userInfo is required' }],
    });

    const response = await handleError(broken, {
      correlationId: 'test-corr',
      skipLog: true,
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.success).toBe(false);
  });
});
