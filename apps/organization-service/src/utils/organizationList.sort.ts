/** GSI1 sort key so ascending queries return newest organizations first. */
export function buildOrgListGsi1Sk(createdAt: number, organizationId: string): string {
  const inverted = (Number.MAX_SAFE_INTEGER - createdAt).toString().padStart(16, '0');
  return `${inverted}#ORG#${organizationId}`;
}
