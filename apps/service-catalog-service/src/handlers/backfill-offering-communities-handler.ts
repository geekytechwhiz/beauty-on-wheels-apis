import { getOfferingCommunitiesService } from '../services/offering-communities.service';

/**
 * Manual invoke only. There is no schedule and no HTTP route.
 * Deploy GSI3 and wait until it is ACTIVE before the first run.
 *
 *   npx serverless invoke -f backfillOfferingCommunities --stage <stage> \
 *     --data '{"vendorId":"<vendorId>","dryRun":true}'
 *
 * Rerun the same command with dryRun false. Existing mappings are left unchanged,
 * including rejected and paused mappings. Changing COMMUNITY_OFFERING_AUTO_APPROVE
 * does not rewrite them. New rows use that flag only when the mapping is absent.
 *
 * Legacy rows with no approvalStatus stay untouched unless legacyApproval is
 * pending. That option stores pending and does not approve historical rows:
 *
 *   npx serverless invoke -f backfillOfferingCommunities --stage <stage> \
 *     --data '{"vendorId":"<vendorId>","dryRun":true,"legacyApproval":"pending"}'
 */
export async function handler(event: unknown): Promise<unknown> {
  const body = typeof event === 'object' && event !== null
    ? event as Record<string, unknown>
    : {};
  const vendorId = typeof body.vendorId === 'string' ? body.vendorId.trim() : '';
  if (!vendorId) {
    throw new Error('vendorId is required');
  }
  if (typeof body.dryRun !== 'boolean') {
    throw new Error('dryRun boolean is required');
  }
  const legacyApproval = body.legacyApproval === undefined || body.legacyApproval === 'preserve'
    ? 'preserve'
    : body.legacyApproval === 'pending'
      ? 'pending'
      : undefined;
  if (!legacyApproval) {
    throw new Error('legacyApproval must be preserve or pending');
  }
  return getOfferingCommunitiesService().backfillVendor(vendorId, body.dryRun, legacyApproval);
}
