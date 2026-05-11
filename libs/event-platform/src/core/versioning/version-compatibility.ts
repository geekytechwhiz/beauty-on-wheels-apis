import { compareVersions, parseSemver } from './compare-versions';
import { VersionCompatibilityStrategy } from '../../typings/consumer.types';
import { VersionCheckConfig } from '../../typings/consumer.types';
import { VersionIncompatibleError } from './version-parse-error';


 
 
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
      const _exhaustive: never = (config.strategy ?? 'strict') as never;
      throw new Error(`Invalid version compatibility strategy: ${_exhaustive}`);
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
      config.strategy as VersionCompatibilityStrategy,
    );
  }

  // 🔥 Deprecation hook
  if (config.deprecatedVersions?.includes(eventVersion)) {
    config.onDeprecated?.(eventVersion);
  }

  // ⚠️ Forward compatibility warning
  if (config.strategy === 'forward') {
    console.warn(
      `Forward compatibility enabled for ${eventVersion}. Ensure schema is additive.`,
    );
  }
}