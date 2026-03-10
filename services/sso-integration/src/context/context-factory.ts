import { RequestContext } from './request-context';
import {
  deriveTenantIdFromIntegration,
  IntegrationMetadata,
  UserSourceSystem,
} from '../types/integration.types';

export async function buildSchedulerContext(
  tenantOrIntegration: string | IntegrationMetadata,
  correlationId: string
): Promise<RequestContext> {
  const integration =
    typeof tenantOrIntegration === 'string' ? undefined : tenantOrIntegration;

  const tenantId =
    typeof tenantOrIntegration === 'string'
      ? tenantOrIntegration
      : deriveTenantIdFromIntegration(tenantOrIntegration);

  return {
    correlationId,
    tenantId,
    // Scheduler and other internal flows use the special
    // service-to-service token recognized by the authorizer.
    serviceToken: 'service-token',
    source: 'scheduler',
    ...(integration && {
      integration,
      sourceSystem: UserSourceSystem.AFRICA_HMS,
    }),
  };
}