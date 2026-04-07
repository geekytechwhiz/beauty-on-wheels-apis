import type { CreateMetadataTypeInput } from '@api-hub/metadata';
import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { extractActorId } from '../utils/helper';
import { validateCreateMetadataType } from '../validation/request.validators';

interface Params {
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const body = (req as unknown as { validatedCreateMetadataTypeBody: CreateMetadataTypeInput })
    .validatedCreateMetadataTypeBody;
  const actorId = extractActorId(req);
  return getMetadataRegistryService().createMetadataType({
    ...body,
    createdBy: body.createdBy ?? actorId,
  });
};

export const main = withLambdaHandler(handler, {
  validator: validateCreateMetadataType,
});
