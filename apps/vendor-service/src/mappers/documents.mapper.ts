import {
  CreateDocumentRequest,
  DocumentStatus,
  VendorDocument,
} from '../types/api-types';
import { VendorDocumentDdbItem } from '../types/repository.types';
import {
  VENDOR_DOCUMENT_ENTITY_TYPE,
  VendorKeyBuilder,
} from '../utils/constants/vendor-key-builder';
import { DOCUMENT_STATUS } from '../domain/onboarding';

export class DocumentsMapper {
  static toDomain(
    item: VendorDocumentDdbItem,
    urls?: { uploadUrl?: string; downloadUrl?: string; expiresIn?: number },
  ): VendorDocument {
    return {
      documentId: item.documentId,
      vendorId: item.vendorId,
      documentType: item.documentType,
      fileName: item.fileName,
      contentType: item.contentType,
      fileSize: item.fileSize,
      objectKey: item.objectKey,
      status: item.status,
      uploadUrl: urls?.uploadUrl,
      downloadUrl: urls?.downloadUrl,
      expiresIn: urls?.expiresIn,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toPendingUploadItem(params: {
    request: CreateDocumentRequest;
    vendorId: string;
    documentId: string;
    bucket: string;
    objectKey: string;
    existing?: VendorDocumentDdbItem | null;
  }): { item: VendorDocumentDdbItem; orphanObjectKey?: string } {
    const existing = params.existing ?? undefined;
    const supersededObjectKey =
      existing?.status === DOCUMENT_STATUS.UPLOADED &&
      existing.objectKey !== params.objectKey
        ? existing.objectKey
        : existing?.supersededObjectKey &&
            existing.supersededObjectKey !== params.objectKey
          ? existing.supersededObjectKey
          : undefined;

    const orphanObjectKey =
      existing?.status === DOCUMENT_STATUS.PENDING_UPLOAD &&
      existing.objectKey !== params.objectKey &&
      existing.objectKey !== supersededObjectKey
        ? existing.objectKey
        : undefined;

    const item = this.toDdbItem(
      params.request,
      params.vendorId,
      params.documentId,
      { bucket: params.bucket, objectKey: params.objectKey },
      {
        createdAt: existing?.createdAt,
        status: DOCUMENT_STATUS.PENDING_UPLOAD,
        supersededObjectKey,
      },
    );

    return { item, orphanObjectKey };
  }

  static toDdbItem(
    request: CreateDocumentRequest,
    vendorId: string,
    documentId: string,
    storage: { bucket: string; objectKey: string },
    options?: {
      createdAt?: string;
      status?: DocumentStatus;
      supersededObjectKey?: string;
    },
  ): VendorDocumentDdbItem {
    const timestamp = new Date().toISOString();
    const createdAt = options?.createdAt || timestamp;

    return {
      PK: VendorKeyBuilder.vendorPk(vendorId),
      SK: VendorKeyBuilder.documentSk(documentId),
      documentId,
      vendorId,
      documentType: request.documentType,
      fileName: request.fileName,
      contentType: request.contentType,
      fileSize: request.fileSize,
      bucket: storage.bucket,
      objectKey: storage.objectKey,
      ...(options?.supersededObjectKey
        ? { supersededObjectKey: options.supersededObjectKey }
        : {}),
      status: options?.status ?? DOCUMENT_STATUS.PENDING_UPLOAD,
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_DOCUMENT_ENTITY_TYPE,
    };
  }
}
