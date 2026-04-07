import type { CreateMetadataValueInput } from '@api-hub/metadata';
import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { extractActorId } from '../utils/helper';
import { validateCreateMetadataValue } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode } = req.params;
  const body = (req as unknown as { validatedCreateMetadataValueBody: CreateMetadataValueInput })
    .validatedCreateMetadataValueBody;
  const actorId = extractActorId(req);
  return getMetadataRegistryService().createMetadataValue(metadataTypeCode, {
    ...body,
    createdBy: body.createdBy ?? actorId,
  });
};

export const main = withLambdaHandler(handler, {
  validator: validateCreateMetadataValue,
});
