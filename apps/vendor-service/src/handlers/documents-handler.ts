import { withVendorApiHandler } from "./with-vendor-handler";
import { LambdaRequest } from '@api-hub/utils';

import { getDocumentsController } from '../controllers/documents.controller';
import {
  validateCreateDocumentRequest,
  validateUpdateDocumentRequest,
} from '../schemas/documents.schema';

const controller = getDocumentsController();

export const handleListvendordocuments = withVendorApiHandler(
  { operation: 'listvendordocuments' },
  async (request: LambdaRequest) => controller.handleListvendordocuments(request),
);

export const handleCreatevendordocument = withVendorApiHandler(
  {
    operation: 'createvendordocument',
    validator: (request: LambdaRequest) => {
      validateCreateDocumentRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleCreatevendordocument(request),
);

export const handleCreatevendordocumentuploadurl = withVendorApiHandler(
  {
    operation: 'createvendordocumentuploadurl',
    validator: (request: LambdaRequest) => {
      validateCreateDocumentRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleCreatevendordocumentuploadurl(request),
);

export const handleCompletevendordocumentupload = withVendorApiHandler(
  { operation: 'completevendordocumentupload' },
  async (request: LambdaRequest) =>
    controller.handleCompletevendordocumentupload(request),
);

export const handleGetvendordocument = withVendorApiHandler(
  { operation: 'getvendordocument' },
  async (request: LambdaRequest) => controller.handleGetvendordocument(request),
);

export const handleUpdatevendordocument = withVendorApiHandler(
  {
    operation: 'updatevendordocument',
    validator: (request: LambdaRequest) => {
      validateUpdateDocumentRequest(request);
    },
  },
  async (request: LambdaRequest) =>
    controller.handleUpdatevendordocument(request),
);

export const handleDeletevendordocument = withVendorApiHandler(
  { operation: 'deletevendordocument' },
  async (request: LambdaRequest) =>
    controller.handleDeletevendordocument(request),
);
