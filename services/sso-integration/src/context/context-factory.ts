import { RequestContext } from './request-context';
import { getServiceTokenService } from '../services/service-token.service';

export async function buildSchedulerContext(
  tenantId: string,
  correlationId: string
): Promise<RequestContext> {

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
  };
}