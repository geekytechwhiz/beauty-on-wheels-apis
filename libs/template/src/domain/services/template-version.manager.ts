import type { TemplateMetadata } from '../template.types';

function isPublishedStatus(status: string): boolean {
  return status === 'PUBLISHED' || status === 'published';
}

function parseVersionNumber(version: string): number | null {
  const match = /^v?(\d+)$/i.exec(version.trim());
  return match ? parseInt(match[1], 10) : null;
}

function compareVersionsDescending(left: string, right: string): number {
  const leftVersion = parseVersionNumber(left);
  const rightVersion = parseVersionNumber(right);

  if (leftVersion !== null && rightVersion !== null) {
    return rightVersion - leftVersion;
  }

  return right.localeCompare(left);
}

export class TemplateVersionManager {
  getNextVersion(versions: string[]): string {
    const versionNumbers = versions
      .map(parseVersionNumber)
      .filter((value): value is number => value !== null);

    const next = versionNumbers.length > 0 ? Math.max(...versionNumbers) + 1 : 1;
    return `v${next}`;
  }

  getLatestVersion(versions: TemplateMetadata[]): TemplateMetadata | null {
    if (versions.length === 0) return null;

    return [...versions].sort((left, right) => compareVersionsDescending(left.version, right.version))[0] ?? null;
  }

  getPublishedVersion(versions: TemplateMetadata[]): TemplateMetadata | null {
    const publishedVersions = versions.filter((v) => isPublishedStatus(v.status));
    return this.getLatestVersion(publishedVersions);
  }

  getRollbackTarget(versions: TemplateMetadata[], currentVersion: string): TemplateMetadata | null {
    const orderedVersions = [...versions].sort((left, right) => compareVersionsDescending(left.version, right.version));
    const currentIndex = orderedVersions.findIndex((version) => version.version === currentVersion);
    if (currentIndex < 0) return null;
    return orderedVersions[currentIndex + 1] ?? null;
  }
}
