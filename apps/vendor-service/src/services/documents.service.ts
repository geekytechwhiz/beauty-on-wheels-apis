import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  isConditionalWriteConflictAtIndex,
} from '@api-hub/utils';
import { createLogger, createChildLogger } from '@api-hub/observability';

import {
  DocumentsRepository,
  getDocumentsRepository,
} from '../repositories/documents.repository';
import {
  VendorsRepository,
  getVendorsRepository,
} from '../repositories/vendors.repository';
import { DocumentsMapper } from '../mappers/documents.mapper';
import { VendorsMapper } from '../mappers/vendors.mapper';
import {
  CreateDocumentRequest,
  UpdateDocumentRequest,
  VendorDocument,
} from '../types/api-types';
import {
  computeStateFromAggregate,
  toVendorAggregate,
} from '../domain/vendor-aggregate';
import {
  DocumentStorage,
  getDocumentStorage,
} from '../storage/document-storage';
import {
  assertVendorAccess,
  getPathParam,
  getVendorId,
} from '../utils/helpers';

const baseLogger = createLogger({
  service: 'documents-service',
  redactPII: true,
});

export class DocumentsService {
  private readonly logger = createChildLogger(baseLogger, {
    service: 'DocumentsService',
  });

  constructor(
    private readonly repository: DocumentsRepository = getDocumentsRepository(),
    private readonly vendorsRepository: VendorsRepository = getVendorsRepository(),
    private readonly documentStorage: DocumentStorage = getDocumentStorage(),
  ) {}

  private async requireAccessibleVendor(request: LambdaRequest) {
    const vendorId = getVendorId(request);
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      throw new NotFoundError('Vendor not found');
    }
    assertVendorAccess(request, vendor);
    return vendor;
  }

  private async syncOnboarding(vendorId: string): Promise<void> {
    const vendor = await this.vendorsRepository.getVendorById(vendorId);
    if (!vendor) {
      return;
    }
    const aggregate = toVendorAggregate(
      await this.vendorsRepository.queryVendorItems(vendorId),
    );
    aggregate.profile = vendor;
    const state = computeStateFromAggregate(aggregate);
    const updated = VendorsMapper.applyOnboardingState(vendor, {
      ...state,
      primaryBranchId: vendor.primaryBranchId,
      addressCity: aggregate.address?.city,
      addressPostalCode: aggregate.address?.postalCode,
    });
    await this.vendorsRepository.updateVendor(updated);
  }

  private async withUrls(
    item: Parameters<typeof DocumentsMapper.toDomain>[0],
    includeUpload = false,
  ): Promise<VendorDocument> {
    const downloadUrl = await this.documentStorage.createDownloadUrl({
      bucket: item.bucket,
      objectKey: item.objectKey,
    });
    let uploadUrl: string | undefined;
    if (includeUpload) {
      const upload = await this.documentStorage.createUploadUrl({
        objectKey: item.objectKey,
        contentType: item.contentType,
      });
      uploadUrl = upload.uploadUrl;
    }
    return DocumentsMapper.toDomain(item, { uploadUrl, downloadUrl });
  }

  async listvendordocuments(
    request: LambdaRequest,
  ): Promise<{ data: VendorDocument[] }> {
    const vendor = await this.requireAccessibleVendor(request);
    const items = await this.repository.listDocuments(vendor.vendorId);
    const data = await Promise.all(items.map((item) => this.withUrls(item)));
    return { data };
  }

  async createvendordocument(request: LambdaRequest): Promise<VendorDocument> {
    const vendor = await this.requireAccessibleVendor(request);
    const body = request.body as CreateDocumentRequest;

    const existing = await this.repository.findByDocumentType(
      vendor.vendorId,
      body.documentType,
    );
    if (existing) {
      throw new ConflictError(
        `Document of type ${body.documentType} already exists`,
      );
    }

    const documentId = randomUUID();
    const objectKey = this.documentStorage.createObjectKey(
      vendor.vendorId,
      documentId,
      body.fileName,
    );
    const upload = await this.documentStorage.createUploadUrl({
      objectKey,
      contentType: body.contentType,
    });
    const ddbItem = DocumentsMapper.toDdbItem(
      body,
      vendor.vendorId,
      documentId,
      { bucket: upload.bucket, objectKey: upload.objectKey },
    );

    try {
      await this.repository.createDocument(ddbItem);
    } catch (err) {
      if (isConditionalWriteConflictAtIndex(err, 0)) {
        throw new NotFoundError('Vendor not found');
      }
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Document already exists');
      }
      throw err;
    }

    await this.syncOnboarding(vendor.vendorId);
    return DocumentsMapper.toDomain(ddbItem, { uploadUrl: upload.uploadUrl });
  }

  async getvendordocument(request: LambdaRequest): Promise<VendorDocument> {
    const vendor = await this.requireAccessibleVendor(request);
    const documentId = getPathParam(request, 'documentId');
    const item = await this.repository.getDocument(vendor.vendorId, documentId);
    if (!item) {
      throw new NotFoundError('Document not found');
    }
    return this.withUrls(item, true);
  }

  async updatevendordocument(request: LambdaRequest): Promise<VendorDocument> {
    const vendor = await this.requireAccessibleVendor(request);
    const documentId = getPathParam(request, 'documentId');
    const body = request.body as UpdateDocumentRequest;
    const existing = await this.repository.getDocument(
      vendor.vendorId,
      documentId,
    );
    if (!existing) {
      throw new NotFoundError('Document not found');
    }

    const fileName = body.fileName ?? existing.fileName;
    const contentType = body.contentType ?? existing.contentType;
    const objectKey = this.documentStorage.createObjectKey(
      vendor.vendorId,
      documentId,
      fileName,
    );
    const upload = await this.documentStorage.createUploadUrl({
      objectKey,
      contentType,
    });

    const updated = {
      ...existing,
      fileName,
      contentType,
      bucket: upload.bucket,
      objectKey: upload.objectKey,
      status: 'PENDING_UPLOAD' as const,
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.repository.updateDocument(updated);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Document update conflict');
      }
      throw err;
    }

    await this.syncOnboarding(vendor.vendorId);
    return DocumentsMapper.toDomain(updated, { uploadUrl: upload.uploadUrl });
  }

  async deletevendordocument(request: LambdaRequest): Promise<void> {
    const vendor = await this.requireAccessibleVendor(request);
    const documentId = getPathParam(request, 'documentId');
    const existing = await this.repository.getDocument(
      vendor.vendorId,
      documentId,
    );
    if (!existing) {
      throw new NotFoundError('Document not found');
    }

    try {
      await this.repository.deleteDocument(vendor.vendorId, documentId);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new NotFoundError('Document not found');
      }
      throw err;
    }

    await this.syncOnboarding(vendor.vendorId);
  }
}

let service: DocumentsService;

export function getDocumentsService() {
  if (!service) {
    service = new DocumentsService();
  }
  return service;
}
