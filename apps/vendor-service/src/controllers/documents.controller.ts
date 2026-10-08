import { LambdaRequest } from '@api-hub/utils';

import {
  DocumentsService,
  getDocumentsService,
} from '../services/documents.service';

export class DocumentsController {
  constructor(
    private readonly service: DocumentsService = getDocumentsService(),
  ) {}

  async handleListvendordocuments(request: LambdaRequest) {
    return this.service.listvendordocuments(request);
  }

  async handleCreatevendordocument(request: LambdaRequest) {
    return this.service.createvendordocument(request);
  }

  async handleCreatevendordocumentuploadurl(request: LambdaRequest) {
    return this.service.createvendordocumentuploadurl(request);
  }

  async handleCompletevendordocumentupload(request: LambdaRequest) {
    return this.service.completevendordocumentupload(request);
  }

  async handleGetvendordocument(request: LambdaRequest) {
    return this.service.getvendordocument(request);
  }

  async handleUpdatevendordocument(request: LambdaRequest) {
    return this.service.updatevendordocument(request);
  }

  async handleDeletevendordocument(request: LambdaRequest) {
    return this.service.deletevendordocument(request);
  }
}

let controller: DocumentsController;

export function getDocumentsController() {
  if (!controller) {
    controller = new DocumentsController();
  }
  return controller;
}
