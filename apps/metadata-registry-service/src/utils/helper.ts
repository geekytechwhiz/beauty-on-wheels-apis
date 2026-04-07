import type { LambdaRequest } from '@api-hub/utils';

/** Same authorizer chain as organization-service createOrganization handler. */
export function extractActorId(req: LambdaRequest): string | undefined {
  const authorizer = req.event?.requestContext?.authorizer as
    | Record<string, unknown>
    | undefined;
  const claims = authorizer?.claims as Record<string, unknown> | undefined;
  return (
    (req as { context?: { user?: { userId?: string } } }).context?.user?.userId ??
    req.context?.userContext?.userId ??
    (authorizer?.userId as string | undefined) ??
    (authorizer?.userID as string | undefined) ??
    (claims?.sub as string | undefined) ??
    (claims?.['custom:userID'] as string | undefined)
  );
}
