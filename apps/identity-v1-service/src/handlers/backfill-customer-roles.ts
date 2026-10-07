import { createLogger } from '@api-hub/observability';

import { backfillApplicationRoles } from '../auth/application-role-assignment';
import { identityRepositoryInstance } from '../repositories/identity.repository';

const logger = createLogger({
  service: 'identity-role-backfill',
  redactPII: true,
});

/**
 * One-shot, idempotent backfill. Invoke after deploy:
 * aws lambda invoke --function-name <stack>-backfillCustomerRoles out.json
 */
export async function handler(): Promise<{
  scanned: number;
  assignedCustomer: number;
  preserved: number;
  unchanged: number;
}> {
  const summary = await backfillApplicationRoles(identityRepositoryInstance);
  logger.info({ event: 'application_role_backfill_complete', ...summary });
  return summary;
}
