import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { validateValidateMetadataValue } from '../validation/request.validators';

interface Params {
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const parsed = (
    req as unknown as {
      validatedValidateMetadataValueBody: {
        metadataTypeCode: string;
        metadataValueCode: string;
        context: { module: string; category: string; condition: string; country: string };
      };
    }
  ).validatedValidateMetadataValueBody;
  return getMetadataRegistryService().validateMetadataValue(
    parsed.metadataTypeCode,
    parsed.metadataValueCode,
    parsed.context,
  );
};

export const main = withLambdaHandler(handler, {
  validator: validateValidateMetadataValue,
});
