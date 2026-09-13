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

export class DocumentsMapper {
  static toDomain(
    item: VendorDocumentDdbItem,
    urls?: { uploadUrl?: string; downloadUrl?: string },
  ): VendorDocument {
    return {
      documentId: item.documentId,
      vendorId: item.vendorId,
      documentType: item.documentType,
      fileName: item.fileName,
      contentType: item.contentType,
      objectKey: item.objectKey,
      status: item.status,
      uploadUrl: urls?.uploadUrl,
      downloadUrl: urls?.downloadUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  static toDdbItem(
    request: CreateDocumentRequest,
    vendorId: string,
    documentId: string,
    storage: { bucket: string; objectKey: string },
    options?: { createdAt?: string; status?: DocumentStatus },
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
      bucket: storage.bucket,
      objectKey: storage.objectKey,
      status: options?.status ?? 'PENDING_UPLOAD',
      createdAt,
      updatedAt: timestamp,
      entityType: VENDOR_DOCUMENT_ENTITY_TYPE,
    };
  }
}
