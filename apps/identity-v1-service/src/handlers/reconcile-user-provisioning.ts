import { createLogger } from '@api-hub/observability';

import { getUserProvisioningService } from '../services/user-provisioning.service';

const logger = createLogger({ service: 'identity-provisioning-reconciliation', redactPII: true });

/** Periodic, bounded replay for PENDING records after stream/DLQ retention expires. */
export async function handler(): Promise<{ scanned: number; republished: number }> {
  const result = await getUserProvisioningService().reconcilePending();
  logger.info({ event: 'user_provisioning_reconciliation', ...result });
  return result;
}
