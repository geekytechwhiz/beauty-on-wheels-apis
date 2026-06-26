import { omitUndefined } from './omit-undefined';

describe('omitUndefined', () => {
  it('removes undefined keys and keeps false and zero', () => {
    expect(
      omitUndefined({
        a: 1,
        b: undefined,
        c: false,
        d: 0,
        e: '',
      }),
    ).toEqual({ a: 1, c: false, d: 0, e: '' });
  });
});
