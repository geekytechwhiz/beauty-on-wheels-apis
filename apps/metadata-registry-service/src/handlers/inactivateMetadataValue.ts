import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { extractActorId } from '../utils/helper';
import { validateMetadataTypeAndValueParams } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  metadataValueCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode, metadataValueCode } = req.params;
  const actorId = extractActorId(req);
  return getMetadataRegistryService().inactivateMetadataValue(
    metadataTypeCode,
    metadataValueCode,
    actorId,
  );
};

export const main = withLambdaHandler(handler, {
  validator: validateMetadataTypeAndValueParams,
});
