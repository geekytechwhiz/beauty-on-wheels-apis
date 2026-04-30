import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils'; 
import { UserService } from '../services/user.service';

interface ExternalQuery {
  tenant?: string;
  provider?: string;
  externalUserId?: string;
}
const userService = new UserService();

const handler = async (req: LambdaRequest<any, ExternalQuery>) => {
  const tenant =
    req.params.tenant ??
    (req.event as any)?.queryStringParameters?.tenant ??
    (req.event as any)?.tenant;

  const provider =
    req.params.provider ??
    (req.event as any)?.queryStringParameters?.provider ??
    (req.event as any)?.provider;

  const externalUserId =
    req.params.externalUserId ??
    (req.event as any)?.queryStringParameters?.externalUserId ??
    (req.event as any)?.externalUserId;

  if (!tenant || !provider || !externalUserId) {
    const err: any = new Error(
      'tenant, provider and externalUserId are required query parameters',
    );
    err.statusCode = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const user = await userService.getUserByExternalIdentity(
    tenant,
    provider,
    externalUserId,
  );

  if (!user) {
    return null;
  }

  return user;
};

export const main = withLambdaHandler(handler);
