function parseVersionNumber(v: string): number | null {
  const m = /^v?(\d+)$/i.exec(v.trim());
  return m ? parseInt(m[1], 10) : null;
}

/** Next immutable version label (v1, v2, …) from existing version strings. */
export function nextVersionFromList(versions: string[]): string {
  const nums = versions.map(parseVersionNumber).filter((n): n is number => n !== null);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `v${next}`;
}
