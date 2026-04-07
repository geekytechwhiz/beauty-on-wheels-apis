import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { extractActorId } from '../utils/helper';
import { validateMetadataTypeCodeParam } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode } = req.params;
  const actorId = extractActorId(req);
  return getMetadataRegistryService().inactivateMetadataType(metadataTypeCode, actorId);
};

export const main = withLambdaHandler(handler, {
  validator: validateMetadataTypeCodeParam,
});
