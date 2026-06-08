import { ValidationError } from '../domain/errors';
import { assertRegistryPostMetadataAction, assertMetadataPublishRequestBody } from './registry-route.validation';

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

  it('returns publish as implemented action', () => {
    expect(assertRegistryPostMetadataAction('publish')).toBe('publish');
    expect(assertRegistryPostMetadataAction('PUBLISH')).toBe('publish');
  });

  it('throws for unknown action values', () => {
    expect(() => assertRegistryPostMetadataAction('upsert')).toThrow(ValidationError);
  });
});

describe('assertMetadataPublishRequestBody', () => {
  it('parses valid publish body', () => {
    expect(
      assertMetadataPublishRequestBody({
        changeRequestId: 'cr_1',
        confirmationAcknowledged: true,
        expectedBaseVersion: 2,
      }),
    ).toEqual({
      changeRequestId: 'cr_1',
      confirmationAcknowledged: true,
      expectedBaseVersion: 2,
    });
  });

  it('accepts null expectedBaseVersion for Add', () => {
    expect(
      assertMetadataPublishRequestBody({
        changeRequestId: 'cr_1',
        confirmationAcknowledged: false,
        expectedBaseVersion: null,
      }).expectedBaseVersion,
    ).toBeNull();
  });

  it('throws when confirmationAcknowledged is missing', () => {
    expect(() =>
      assertMetadataPublishRequestBody({
        changeRequestId: 'cr_1',
        expectedBaseVersion: 1,
      }),
    ).toThrow(ValidationError);
  });
});
