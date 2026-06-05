import { buildApplSortKeys, extractValueCodeFromApplSk, typeEntitySk, valueSk } from './keys';

describe('keys', () => {
  it('typeEntitySk matches access pattern TYPE#METADATA#v<version>', () => {
    expect(typeEntitySk(1)).toBe('TYPE#METADATA#v1');
    expect(typeEntitySk(2)).toBe('TYPE#METADATA#v2');
  });

  it('valueSk', () => {
    expect(valueSk('BP_SYS', 3)).toBe('VALUE#BP_SYS#v3');
  });

  it('buildApplSortKeys uses wildcard for empty dimensions', () => {
    const keys = buildApplSortKeys('CODE', {
      module: ['M'],
      category: [],
      condition: [],
      country: [],
    });
    expect(keys.some((k) => k.includes('#*#') && k.endsWith('#VALUE#CODE'))).toBe(true);
  });

  it('buildApplSortKeys includes explicit language segment', () => {
    const keys = buildApplSortKeys('CODE', {
      module: ['M'],
      category: ['C'],
      condition: [],
      country: [],
      language: ['EN'],
    });
    expect(keys).toContain('APPL#M#C#*#*#EN#VALUE#CODE');
  });

  it('extractValueCodeFromApplSk', () => {
    expect(extractValueCodeFromApplSk('APPL#M#C#*#*#*#VALUE#FOO')).toBe('FOO');
  });
});
