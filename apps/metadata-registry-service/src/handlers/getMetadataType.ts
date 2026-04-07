import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { validateMetadataTypeCodeParam } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode } = req.params;
  return getMetadataRegistryService().getMetadataType(metadataTypeCode);
};

export const main = withLambdaHandler(handler, {
  validator: validateMetadataTypeCodeParam,
});
