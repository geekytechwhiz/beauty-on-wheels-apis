import { withLambdaHandler, type LambdaRequest } from '@api-hub/utils';
import { MetadataValidationError } from '@api-hub/metadata';
import { getService } from '../utils/service-factory';

const validate = (req: LambdaRequest) => {
  if (!req.pathParameters?.metadataTypeCode) {
    throw new MetadataValidationError('metadataTypeCode path parameter is required');
  }
};

const handler = async (req: LambdaRequest) => {
  const metadataTypeCode = req.pathParameters!.metadataTypeCode;
  return getService().getMetadataType(metadataTypeCode);
};

export const main = withLambdaHandler(handler, { validator: validate });
