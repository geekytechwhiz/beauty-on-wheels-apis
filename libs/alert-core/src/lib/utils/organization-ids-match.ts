/** Compare stored org id with JWT org (either may use optional `ORG#` prefix). */
export function organizationIdsMatch(recordOrg: string | undefined, requestOrg: string): boolean {
  if (!recordOrg?.trim() || !requestOrg.trim()) return false;
  const norm = (id: string) =>
    id
      .trim()
      .replace(/^ORG#/i, '')
      .toLowerCase();
  return norm(recordOrg) === norm(requestOrg);
}
