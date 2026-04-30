import { compareVersions } from './compare-versions';
import { VersionParseError } from './version-parse-error';
import {
  assertVersionCompatible,
  isVersionCompatible,
  VersionIncompatibleError,
} from './version-compatibility';

describe('compareVersions', () => {
  it('orders major.minor.patch numerically', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('rejects non-semver strings', () => {
    expect(() => compareVersions('1', '1.0.0')).toThrow(VersionParseError);
  });
});

describe('isVersionCompatible', () => {
  const supported = '1.2.0';

  describe('strict', () => {
    it('accepts only exact match on same major', () => {
      expect(
        isVersionCompatible('1.2.0', { strategy: 'strict', supportedVersion: supported }),
      ).toBe(true);
      expect(
        isVersionCompatible('1.2.1', { strategy: 'strict', supportedVersion: supported }),
      ).toBe(false);
    });
  });

  describe('backward', () => {
    it('accepts event <= supported when major matches', () => {
      expect(
        isVersionCompatible('1.0.0', { strategy: 'backward', supportedVersion: supported }),
      ).toBe(true);
      expect(
        isVersionCompatible('1.2.0', { strategy: 'backward', supportedVersion: supported }),
      ).toBe(true);
      expect(
        isVersionCompatible('1.3.0', { strategy: 'backward', supportedVersion: supported }),
      ).toBe(false);
    });
  });

  describe('forward', () => {
    it('accepts event >= supported when major matches', () => {
      expect(
        isVersionCompatible('1.3.0', { strategy: 'forward', supportedVersion: supported }),
      ).toBe(true);
      expect(
        isVersionCompatible('1.2.0', { strategy: 'forward', supportedVersion: supported }),
      ).toBe(true);
      expect(
        isVersionCompatible('1.1.0', { strategy: 'forward', supportedVersion: supported }),
      ).toBe(false);
    });
  });

  it('rejects different major versions', () => {
    expect(
      isVersionCompatible('2.0.0', { strategy: 'backward', supportedVersion: supported }),
    ).toBe(false);
  });
});

describe('assertVersionCompatible', () => {
  it('throws VersionIncompatibleError when incompatible', () => {
    expect(() =>
      assertVersionCompatible('2.0.0', {
        strategy: 'strict',
        supportedVersion: '1.0.0',
      }),
    ).toThrow(VersionIncompatibleError);
  });
});
