import { randomUUID } from 'crypto';
import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ConditionalWriteConflictError,
  NotFoundError,
  ValidationError,
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
  UpdateDocumentRequest,
  VendorDocument,
} from '../types/api-types';
import { VendorDocumentDdbItem } from '../types/repository.types';
import {
  computeStateFromAggregate,
  toVendorAggregate,
} from '../domain/vendor-aggregate';
import {
  ParsedDocumentUpload,
  assertDocumentsMutable,
  contentTypeMatchesSignature,
  createDocumentObjectKey,
  documentBelongsToVendor,
  normalizeContentType,
  parseDocumentUploadRequest,
} from '../domain/document-upload';
import { DOCUMENT_STATUS } from '../domain/onboarding';
import { env } from '../configs/env.config';
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
      onboardingStatus: state.status,
      currentSection: state.currentSection,
      completedSections: state.completedSections,
      primaryBranchId: vendor.primaryBranchId,
      addressCity: aggregate.address?.city,
      addressPostalCode: aggregate.address?.postalCode,
    });
    await this.vendorsRepository.updateVendor(updated);
  }

  private async withUrls(
    item: VendorDocumentDdbItem,
    includeUpload = false,
  ): Promise<VendorDocument> {
    if (item.status === DOCUMENT_STATUS.UPLOADED) {
      const downloadUrl = await this.documentStorage.createDownloadUrl({
        bucket: item.bucket,
        objectKey: item.objectKey,
      });
      return DocumentsMapper.toDomain(item, {
        downloadUrl,
        expiresIn: downloadUrl ? env.DOCUMENT_DOWNLOAD_URL_EXPIRY : undefined,
      });
    }

    if (includeUpload && item.status === DOCUMENT_STATUS.PENDING_UPLOAD) {
      const upload = await this.documentStorage.createUploadUrl({
        objectKey: item.objectKey,
        contentType: item.contentType,
        fileSize: item.fileSize,
      });
      return DocumentsMapper.toDomain(item, {
        uploadUrl: upload.uploadUrl,
        expiresIn: upload.expiresIn,
      });
    }

    return DocumentsMapper.toDomain(item);
  }

  private async stageUpload(params: {
    vendorId: string;
    parsed: ParsedDocumentUpload;
    existing: VendorDocumentDdbItem | null;
    documentId: string;
  }): Promise<VendorDocument> {
    const objectKey = createDocumentObjectKey(
      params.vendorId,
      params.documentId,
      params.parsed.contentType,
    );
    const upload = await this.documentStorage.createUploadUrl({
      objectKey,
      contentType: params.parsed.contentType,
      fileSize: params.parsed.fileSize,
    });
    if (upload.objectKey !== objectKey) {
      throw new ValidationError('Document object key could not be created');
    }

    const { item, orphanObjectKey } = DocumentsMapper.toPendingUploadItem({
      request: params.parsed,
      vendorId: params.vendorId,
      documentId: params.documentId,
      bucket: upload.bucket,
      objectKey,
      existing: params.existing,
    });

    if (orphanObjectKey) {
      await this.documentStorage.deleteObject({
        bucket: params.existing?.bucket || upload.bucket,
        objectKey: orphanObjectKey,
      });
    }

    try {
      if (params.existing) {
        await this.repository.updateDocument(item);
      } else {
        await this.repository.createDocument(item);
      }
    } catch (err) {
      if (!params.existing && isConditionalWriteConflictAtIndex(err, 0)) {
        throw new NotFoundError('Vendor not found');
      }
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError(
          params.existing ? 'Document update conflict' : 'Document already exists',
        );
      }
      throw err;
    }

    await this.syncOnboarding(params.vendorId);
    return DocumentsMapper.toDomain(item, {
      uploadUrl: upload.uploadUrl,
      expiresIn: upload.expiresIn,
    });
  }

  private async issueUploadUrl(request: LambdaRequest): Promise<VendorDocument> {
    const vendor = await this.requireAccessibleVendor(request);
    assertDocumentsMutable(vendor.onboardingStatus);
    const parsed = parseDocumentUploadRequest(request.body);
    const existing = await this.repository.findByDocumentType(
      vendor.vendorId,
      parsed.documentType,
    );

    return this.stageUpload({
      vendorId: vendor.vendorId,
      parsed,
      existing,
      documentId: existing?.documentId ?? randomUUID(),
    });
  }

  private async verifyStoredObject(item: VendorDocumentDdbItem): Promise<void> {
    if (!documentBelongsToVendor(item.vendorId, item.objectKey)) {
      throw new ConflictError('Invalid document state');
    }

    const head = await this.documentStorage.headObject({
      bucket: item.bucket,
      objectKey: item.objectKey,
    });
    if (!head) {
      throw new NotFoundError('S3 object missing');
    }

    if (
      head.contentType &&
      normalizeContentType(head.contentType) !== item.contentType
    ) {
      throw new ValidationError(
        'S3 upload confirmation failed: content type does not match',
      );
    }

    if (
      item.fileSize !== undefined &&
      head.contentLength !== undefined &&
      head.contentLength !== item.fileSize
    ) {
      throw new ValidationError(
        'S3 upload confirmation failed: file size does not match',
      );
    }

    const prefix = await this.documentStorage.readPrefix({
      bucket: item.bucket,
      objectKey: item.objectKey,
      bytes: 16,
    });
    if (!contentTypeMatchesSignature(item.contentType, prefix)) {
      throw new ValidationError(
        'S3 upload confirmation failed: file signature does not match content type',
      );
    }
  }

  private async deleteSupersededObject(
    item: VendorDocumentDdbItem,
  ): Promise<void> {
    if (
      !item.supersededObjectKey ||
      item.supersededObjectKey === item.objectKey
    ) {
      return;
    }
    await this.documentStorage.deleteObject({
      bucket: item.bucket,
      objectKey: item.supersededObjectKey,
    });
  }

  private withoutSuperseded(item: VendorDocumentDdbItem): VendorDocumentDdbItem {
    const next = { ...item };
    delete next.supersededObjectKey;
    return next;
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
    return this.issueUploadUrl(request);
  }

  async createvendordocumentuploadurl(
    request: LambdaRequest,
  ): Promise<VendorDocument> {
    return this.issueUploadUrl(request);
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

  async completevendordocumentupload(
    request: LambdaRequest,
  ): Promise<VendorDocument> {
    const vendor = await this.requireAccessibleVendor(request);
    const documentId = getPathParam(request, 'documentId');
    const existing = await this.repository.getDocument(
      vendor.vendorId,
      documentId,
    );
    if (!existing) {
      throw new NotFoundError('Document not found');
    }

    if (existing.status === DOCUMENT_STATUS.UPLOADED) {
      await this.verifyStoredObject(existing);
      await this.deleteSupersededObject(existing);
      const cleared = this.withoutSuperseded(existing);
      if (existing.supersededObjectKey) {
        await this.repository.updateDocument(cleared);
      }
      return this.withUrls(cleared);
    }

    if (existing.status !== DOCUMENT_STATUS.PENDING_UPLOAD) {
      throw new ConflictError('Invalid document state');
    }

    assertDocumentsMutable(vendor.onboardingStatus);
    await this.verifyStoredObject(existing);
    await this.deleteSupersededObject(existing);

    const updated = this.withoutSuperseded({
      ...existing,
      status: DOCUMENT_STATUS.UPLOADED,
      updatedAt: new Date().toISOString(),
    });

    try {
      await this.repository.updateDocument(updated);
    } catch (err) {
      if (err instanceof ConditionalWriteConflictError) {
        throw new ConflictError('Document update conflict');
      }
      throw err;
    }

    await this.syncOnboarding(vendor.vendorId);
    this.logger.info({
      event: 'completevendordocumentupload_success',
      vendorId: vendor.vendorId,
      documentId,
    });
    return this.withUrls(updated);
  }

  async updatevendordocument(request: LambdaRequest): Promise<VendorDocument> {
    const vendor = await this.requireAccessibleVendor(request);
    assertDocumentsMutable(vendor.onboardingStatus);
    const documentId = getPathParam(request, 'documentId');
    const body = request.body as UpdateDocumentRequest;
    const existing = await this.repository.getDocument(
      vendor.vendorId,
      documentId,
    );
    if (!existing) {
      throw new NotFoundError('Document not found');
    }

    const parsed = parseDocumentUploadRequest({
      documentType: existing.documentType,
      fileName: body.fileName ?? existing.fileName,
      contentType: body.contentType ?? existing.contentType,
      fileSize: body.fileSize ?? existing.fileSize,
    });

    return this.stageUpload({
      vendorId: vendor.vendorId,
      parsed,
      existing,
      documentId,
    });
  }

  async deletevendordocument(request: LambdaRequest): Promise<void> {
    const vendor = await this.requireAccessibleVendor(request);
    assertDocumentsMutable(vendor.onboardingStatus);
    const documentId = getPathParam(request, 'documentId');
    const existing = await this.repository.getDocument(
      vendor.vendorId,
      documentId,
    );
    if (!existing) {
      throw new NotFoundError('Document not found');
    }

    await this.documentStorage.deleteObject({
      bucket: existing.bucket,
      objectKey: existing.objectKey,
    });
    await this.deleteSupersededObject(existing);

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
