import { ValidationError } from '../domain/errors';
import { assertRegistryPostMetadataAction } from './registry-route.validation';

describe('assertRegistryPostMetadataAction', () => {
  it('returns draft for valid implemented action', () => {
    expect(assertRegistryPostMetadataAction('draft')).toBe('draft');
    expect(assertRegistryPostMetadataAction('DRAFT')).toBe('draft');
    expect(assertRegistryPostMetadataAction(' draft ')).toBe('draft');
  });

  it('throws when action is missing', () => {
    expect(() => assertRegistryPostMetadataAction('')).toThrow(ValidationError);
    expect(() => assertRegistryPostMetadataAction('   ')).toThrow(ValidationError);
  });

  it('throws for unknown action values', () => {
    expect(() => assertRegistryPostMetadataAction('upsert')).toThrow(ValidationError);
  });

  it('throws for reserved but not yet implemented actions', () => {
    for (const action of ['impact-preview', 'publish'] as const) {
      try {
        assertRegistryPostMetadataAction(action);
        fail(`expected throw for ${action}`);
      } catch (e) {
        expect(e).toMatchObject({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          details: [{ field: 'action', message: 'Only draft is implemented' }],
        });
      }
    }
  });
});
