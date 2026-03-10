import { RequestContext } from './request-context';
import { getServiceTokenService } from '../services/service-token.service';
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

  const token = await getServiceTokenService().generateToken(
    tenantId,
    {
      userId: 'SYSTEM',
      role: 'SERVICE',
    },
    correlationId
  );

  return {
    correlationId,
    tenantId,
    serviceToken: token.token,
    source: 'scheduler',
    ...(integration && {
      integration,
      sourceSystem: UserSourceSystem.AFRICA_HMS,
    }),
  };
}