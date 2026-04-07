import type { ApplicabilityContext } from '@api-hub/metadata';
import { withLambdaHandler, LambdaRequest } from '@api-hub/utils';
import { getMetadataRegistryService } from '../runtime';
import { validateListMetadataValuesByContext } from '../validation/request.validators';

interface Params {
  metadataTypeCode: string;
  [key: string]: unknown;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { metadataTypeCode } = req.params;
  const ctx = (req as unknown as { validatedApplicabilityContext: ApplicabilityContext })
    .validatedApplicabilityContext;
  return getMetadataRegistryService().listMetadataValuesByContext(metadataTypeCode, ctx);
};

export const main = withLambdaHandler(handler, {
  validator: validateListMetadataValuesByContext,
});
