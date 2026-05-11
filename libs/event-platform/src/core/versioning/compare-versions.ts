import { VersionParseError } from './version-parse-error';

export type SemVerParts = {
  major: number;
  minor: number;
  patch: number;
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parses `major.minor.patch` strings (no prerelease/build). */
export function parseSemver(version: string): SemVerParts {
  const m = SEMVER.exec(version.trim());
  if (!m) {
    throw new VersionParseError(
      `Expected semantic version "major.minor.patch", got: ${version}`,
      version,
    );
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 * Compares two semantic version strings.
 * @returns negative if `a < b`, zero if equal, positive if `a > b`
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) {
    return pa.major < pb.major ? -1 : 1;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor < pb.minor ? -1 : 1;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch < pb.patch ? -1 : 1;
  }
  return 0;
}
