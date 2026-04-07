import type { UpdateMetadataValueInput } from '@api-hub/metadata';
import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { extractActorId } from '../utils/helper';
import { validateUpdateMetadataValue } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  metadataValueCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode, metadataValueCode } = req.params;
  const body = (req as unknown as { validatedUpdateMetadataValueBody: UpdateMetadataValueInput })
    .validatedUpdateMetadataValueBody;
  const actorId = extractActorId(req);
  return getMetadataRegistryService().updateMetadataValue(metadataTypeCode, metadataValueCode, {
    ...body,
    updatedBy: body.updatedBy ?? actorId,
  });
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateMetadataValue,
});
