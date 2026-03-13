import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { UserService } from '../services/user.service';

const userService = new UserService();

interface ExternalQuery {
  tenant?: string;
  provider?: string;
  externalUserId?: string;
}

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
    const { UserNotFoundError } = await import('../errors');
    throw new UserNotFoundError(externalUserId);
  }

  return user;
};

export const main = withLambdaHandler(handler);

