import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { getDocumentsController } from '../controllers/documents.controller';
import {
  validateCreateDocumentRequest,
  validateUpdateDocumentRequest,
} from '../schemas/documents.schema';

const controller = getDocumentsController();

export const handleListvendordocuments = withApiHandler(
  { operation: 'listvendordocuments' },
  async (request: LambdaRequest) => controller.handleListvendordocuments(request),
);

export const handleCreatevendordocument = withApiHandler(
  {
    operation: 'createvendordocument',
    validator: (request: LambdaRequest) => {
      validateCreateDocumentRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleCreatevendordocument(request),
);

export const handleCreatevendordocumentuploadurl = withApiHandler(
  {
    operation: 'createvendordocumentuploadurl',
    validator: (request: LambdaRequest) => {
      validateCreateDocumentRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleCreatevendordocumentuploadurl(request),
);

export const handleCompletevendordocumentupload = withApiHandler(
  { operation: 'completevendordocumentupload' },
  async (request: LambdaRequest) =>
    controller.handleCompletevendordocumentupload(request),
);

export const handleGetvendordocument = withApiHandler(
  { operation: 'getvendordocument' },
  async (request: LambdaRequest) => controller.handleGetvendordocument(request),
);

export const handleUpdatevendordocument = withApiHandler(
  {
    operation: 'updatevendordocument',
    validator: (request: LambdaRequest) => {
      validateUpdateDocumentRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendordocument(request),
);

export const handleDeletevendordocument = withApiHandler(
  { operation: 'deletevendordocument' },
  async (request: LambdaRequest) =>
    controller.handleDeletevendordocument(request),
);
