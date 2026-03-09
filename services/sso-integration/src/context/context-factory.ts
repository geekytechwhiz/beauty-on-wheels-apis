import { RequestContext } from './request-context';
import { getServiceTokenService } from '../services/service-token.service';

export function buildSchedulerContext(
  tenantId: string,
  correlationId: string
): RequestContext {

  const token = getServiceTokenService().generateToken(
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