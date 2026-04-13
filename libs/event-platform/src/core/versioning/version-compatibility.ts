import { compareVersions, parseSemver } from './compare-versions';

export type VersionCompatibilityStrategy = 'strict' | 'backward' | 'forward';

export class VersionIncompatibleError extends Error {
  constructor(
    message: string,
    readonly eventVersion: string,
    readonly supportedVersion: string,
    readonly strategy: VersionCompatibilityStrategy,
  ) {
    super(message);
    this.name = 'VersionIncompatibleError';
  }
}

export type VersionCheckConfig = {
  strategy: VersionCompatibilityStrategy;
  /** Consumer-supported semantic version (e.g. `"1.2.0"`). */
  supportedVersion: string;
};

/**
 * Same major is required; then strategy decides how event vs supported ordering is allowed.
 *
 * - **strict**: event version must equal supported.
 * - **backward**: event must be `<=` supported (consumer handles older or same events).
 * - **forward**: event must be `>=` supported (consumer handles newer or same events).
 */
export function isVersionCompatible(
  eventVersion: string,
  config: VersionCheckConfig,
): boolean {
  const ev = parseSemver(eventVersion);
  const sv = parseSemver(config.supportedVersion);
  if (ev.major !== sv.major) {
    return false;
  }
  const cmp = compareVersions(eventVersion, config.supportedVersion);
  switch (config.strategy) {
    case 'strict':
      return cmp === 0;
    case 'backward':
      return cmp <= 0;
    case 'forward':
      return cmp >= 0;
    default: {
      const _exhaustive: never = config.strategy;
      return _exhaustive;
    }
  }
}

export function assertVersionCompatible(
  eventVersion: string,
  config: VersionCheckConfig,
): void {
  if (!isVersionCompatible(eventVersion, config)) {
    throw new VersionIncompatibleError(
      `Event version "${eventVersion}" is incompatible with supported "${config.supportedVersion}" (${config.strategy})`,
      eventVersion,
      config.supportedVersion,
      config.strategy,
    );
  }
}
