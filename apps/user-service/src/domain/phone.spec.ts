import { requireE164 } from './phone';
import { ValidationError } from '@api-hub/utils';

describe('requireE164', () => {
  it('keeps a valid E.164 number', () => {
    expect(requireE164('+14155552671')).toBe('+14155552671');
  });

  it('restores a plus that a query string turned into whitespace', () => {
    expect(requireE164(' 14155552671')).toBe('+14155552671');
  });

  it('rejects a number that is not E.164', () => {
    expect(() => requireE164('555')).toThrow(ValidationError);
  });
});
