import { ValidationError } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/middleware';
import { inactivateRelationById } from '../services/relationService';

export const main = withLambdaHandler(async (req: {
  params?: Record<string, string>;
  pathParameters?: Record<string, string>;
  context?: { userContext?: { userId?: string } };
}) => {
  const id = req.params?.id ?? req.pathParameters?.id ?? '';
  if (!id) {
    throw new ValidationError('id is required', [{ field: 'id', message: 'Required' }]);
  }
  return inactivateRelationById(id, req.context?.userContext?.userId);
});
