import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { validateMetadataTypeAndValueParams } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  metadataValueCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode, metadataValueCode } = req.params;
  return getMetadataRegistryService().getMetadataValue(metadataTypeCode, metadataValueCode);
};

export const main = withLambdaHandler(handler, {
  validator: validateMetadataTypeAndValueParams,
});
