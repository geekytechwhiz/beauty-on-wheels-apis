import { ValidationError } from '../domain/errors';
import { assertRegistryPostMetadataAction } from './registry-route.validation';

describe('assertRegistryPostMetadataAction', () => {
  it('returns draft for valid implemented action', () => {
    expect(assertRegistryPostMetadataAction('draft')).toBe('draft');
    expect(assertRegistryPostMetadataAction('DRAFT')).toBe('draft');
    expect(assertRegistryPostMetadataAction(' draft ')).toBe('draft');
  });

  it('returns impact-preview as implemented action', () => {
    expect(assertRegistryPostMetadataAction('impact-preview')).toBe('impact-preview');
    expect(assertRegistryPostMetadataAction('IMPACT-PREVIEW')).toBe('impact-preview');
  });

  it('throws when action is missing', () => {
    expect(() => assertRegistryPostMetadataAction('')).toThrow(ValidationError);
    expect(() => assertRegistryPostMetadataAction('   ')).toThrow(ValidationError);
  });

  it('throws for unknown action values', () => {
    expect(() => assertRegistryPostMetadataAction('upsert')).toThrow(ValidationError);
  });

  it('throws for publish until implemented', () => {
    try {
      assertRegistryPostMetadataAction('publish');
      fail('expected throw for publish');
    } catch (e) {
      expect(e).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        details: [{ field: 'action', message: 'Only draft and impact-preview are implemented' }],
      });
    }
  });
});
