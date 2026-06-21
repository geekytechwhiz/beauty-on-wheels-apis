/**
 * Reads `ENABLE_NEW_ORG_CONFIG_FLOW` from the Lambda environment.
 * Defaults to `false` when unset so production/stage keep legacy behavior.
 */
export function isNewOrgConfigFlowEnabled(): boolean {
  const raw = process.env.ENABLE_NEW_ORG_CONFIG_FLOW?.trim().toLowerCase();
  if (raw === 'true' || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === '0') {
    return false;
  }
  return false;
}
