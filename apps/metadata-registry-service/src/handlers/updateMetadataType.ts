import type { UpdateMetadataTypeInput } from '@api-hub/metadata';
import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { extractActorId } from '../utils/helper';
import { validateUpdateMetadataType } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode } = req.params;
  const body = (req as unknown as { validatedUpdateMetadataTypeBody: UpdateMetadataTypeInput })
    .validatedUpdateMetadataTypeBody;
  const actorId = extractActorId(req);
  return getMetadataRegistryService().updateMetadataType(metadataTypeCode, {
    ...body,
    updatedBy: body.updatedBy ?? actorId,
  });
};

export const main = withLambdaHandler(handler, {
  validator: validateUpdateMetadataType,
});
