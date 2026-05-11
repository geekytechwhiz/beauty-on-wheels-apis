export function nextVersionFromList(versions: string[]): string {
  const versionNumbers = versions
    .map((version) => /^v?(\d+)$/i.exec(version.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => parseInt(match[1], 10));

  const next = versionNumbers.length > 0 ? Math.max(...versionNumbers) + 1 : 1;
  return `v${next}`;
}
