import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import { MetadataValidationError } from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  if (!req.pathParameters?.metadataTypeCode) {
    throw new MetadataValidationError('metadataTypeCode path parameter is required');
  }
  if (!req.pathParameters?.metadataValueCode) {
    throw new MetadataValidationError('metadataValueCode path parameter is required');
  }
};

const handler = async (req: LambdaRequest) => {
  const { metadataTypeCode, metadataValueCode } = req.pathParameters!;
  const lastModifiedBy = req.context.userContext?.userId;
  return getService().inactivateMetadataValue(metadataTypeCode, metadataValueCode, lastModifiedBy);
};

export const main = withLambdaHandler(handler, { validator: validate });
