import { LambdaRequest } from '@api-hub/utils';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@api-hub/utils';

import { DocumentsService } from './documents.service';
import { DocumentsRepository } from '../repositories/documents.repository';
import { VendorsRepository } from '../repositories/vendors.repository';
import { DocumentStorage } from '../storage/document-storage';
import {
  VendorDdbItem,
  VendorDocumentDdbItem,
} from '../types/repository.types';

function authRequest(overrides: Record<string, unknown> = {}): LambdaRequest {
  const pathParameters = {
    vendorId: 'vendor-1',
    ...((overrides.pathParameters as object) ?? {}),
  };
  return {
    pathParameters,
    params: {
      vendorId: 'vendor-1',
      ...((overrides.params as object) ?? {}),
      ...pathParameters,
    },
    body: overrides.body,
    context: {
      userContext: { userId: 'user-1' },
      ...((overrides.context as object) ?? {}),
    },
  } as unknown as LambdaRequest;
}

function vendorItem(overrides: Partial<VendorDdbItem> = {}): VendorDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'PROFILE',
    vendorId: 'vendor-1',
    ownerUserId: 'user-1',
    vendorType: 'BUSINESS',
    businessName: 'Glow',
    contactName: 'Priya',
    phoneNumber: '+919876543210',
    status: 'PENDING_VERIFICATION',
    operationalStatus: 'OFFLINE',
    onboardingStatus: 'IN_PROGRESS',
    currentSection: 'DOCUMENTS',
    completedSections: ['BUSINESS_INFO'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    GSI1PK: 'VENDOR',
    GSI1SK: 'STATUS#PENDING_VERIFICATION#OPERATIONAL#OFFLINE#2026-01-01T00:00:00.000Z#vendor-1',
    entityType: 'Vendor',
    ...overrides,
  };
}

function documentItem(
  overrides: Partial<VendorDocumentDdbItem> = {},
): VendorDocumentDdbItem {
  return {
    PK: 'VENDOR#vendor-1',
    SK: 'DOCUMENT#doc-1',
    documentId: 'doc-1',
    vendorId: 'vendor-1',
    documentType: 'GST_REGISTRATION',
    fileName: 'gst-certificate.pdf',
    contentType: 'application/pdf',
    fileSize: 245678,
    bucket: 'vendor-docs',
    objectKey: 'vendors/vendor-1/documents/doc-1.pdf',
    status: 'PENDING_UPLOAD',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entityType: 'VendorDocument',
    ...overrides,
  };
}

const uploadBody = {
  documentType: 'GST_REGISTRATION',
  fileName: 'gst-certificate.pdf',
  contentType: 'application/pdf',
  fileSize: 245678,
  objectKey: 'vendors/someone-else/secret.pdf',
};

const pdfSignature = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

describe('DocumentsService', () => {
  let repository: jest.Mocked<DocumentsRepository>;
  let vendorsRepository: jest.Mocked<VendorsRepository>;
  let documentStorage: jest.Mocked<DocumentStorage>;
  let service: DocumentsService;

  beforeEach(() => {
    repository = {
      createDocument: jest.fn().mockResolvedValue(undefined),
      getDocument: jest.fn(),
      listDocuments: jest.fn().mockResolvedValue([]),
      findByDocumentType: jest.fn().mockResolvedValue(null),
      updateDocument: jest.fn().mockResolvedValue(undefined),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DocumentsRepository>;

    vendorsRepository = {
      getVendorById: jest.fn().mockResolvedValue(vendorItem()),
      queryVendorItems: jest.fn().mockResolvedValue([vendorItem()]),
      updateVendor: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<VendorsRepository>;

    documentStorage = {
      createUploadUrl: jest.fn().mockImplementation(async (params) => ({
        bucket: 'vendor-docs',
        objectKey: params.objectKey,
        uploadUrl: `https://s3.example/upload/${params.objectKey}`,
        expiresIn: 900,
      })),
      createDownloadUrl: jest.fn().mockResolvedValue('https://s3.example/download'),
      headObject: jest.fn(),
      readPrefix: jest.fn(),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DocumentStorage>;

    service = new DocumentsService(repository, vendorsRepository, documentStorage);
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(
      service.createvendordocumentuploadurl(
        authRequest({ context: { userContext: {} }, body: uploadBody }),
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('rejects a caller who does not own the vendor', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ ownerUserId: 'other-user' }),
    );

    await expect(
      service.listvendordocuments(authRequest()),
    ).rejects.toThrow(ForbiddenError);
    expect(repository.listDocuments).not.toHaveBeenCalled();
  });

  it('returns 404 when the vendor does not exist', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(null);

    await expect(
      service.createvendordocumentuploadurl(authRequest({ body: uploadBody })),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects an invalid document type, content type, and oversized file', async () => {
    await expect(
      service.createvendordocumentuploadurl(
        authRequest({ body: { ...uploadBody, documentType: 'TRADE_LICENSE' } }),
      ),
    ).rejects.toThrow(/Unsupported document type/);

    await expect(
      service.createvendordocumentuploadurl(
        authRequest({ body: { ...uploadBody, contentType: 'text/plain' } }),
      ),
    ).rejects.toThrow(/Unsupported content type/);

    await expect(
      service.createvendordocumentuploadurl(
        authRequest({ body: { ...uploadBody, fileSize: 10 * 1024 * 1024 + 1 } }),
      ),
    ).rejects.toThrow(ValidationError);

    expect(repository.createDocument).not.toHaveBeenCalled();
  });

  it('persists pending metadata and a vendor-scoped object key', async () => {
    const result = await service.createvendordocumentuploadurl(
      authRequest({ body: uploadBody }),
    );

    expect(result.status).toBe('PENDING_UPLOAD');
    expect(result.fileSize).toBe(245678);
    expect(result.uploadUrl).toContain('https://s3.example/upload/');
    expect(result.expiresIn).toBe(900);
    expect(result.objectKey).toMatch(
      /^vendors\/vendor-1\/documents\/[A-Za-z0-9-]+\.pdf$/,
    );
    expect(result.objectKey).not.toContain('someone-else');
    expect(result.downloadUrl).toBeUndefined();

    const saved = repository.createDocument.mock.calls[0][0];
    expect(saved.objectKey).toBe(result.objectKey);
    expect(saved.status).toBe('PENDING_UPLOAD');
    expect(saved.bucket).toBe('vendor-docs');
    expect(saved.fileName).toBe('gst-certificate.pdf');
    expect(documentStorage.createUploadUrl).toHaveBeenCalledWith({
      objectKey: result.objectKey,
      contentType: 'application/pdf',
      fileSize: 245678,
    });
  });

  it('reuses the same document when the upload URL is requested again', async () => {
    repository.findByDocumentType.mockResolvedValue(documentItem());

    const result = await service.createvendordocument(
      authRequest({ body: uploadBody }),
    );

    expect(result.documentId).toBe('doc-1');
    expect(result.objectKey).toBe('vendors/vendor-1/documents/doc-1.pdf');
    expect(repository.createDocument).not.toHaveBeenCalled();
    expect(repository.updateDocument).toHaveBeenCalled();
  });

  it('starts a replacement without deleting the confirmed object until completion', async () => {
    repository.findByDocumentType.mockResolvedValue(
      documentItem({
        status: 'UPLOADED',
        contentType: 'application/pdf',
        objectKey: 'vendors/vendor-1/documents/doc-1.pdf',
      }),
    );

    const result = await service.createvendordocumentuploadurl(
      authRequest({
        body: {
          ...uploadBody,
          contentType: 'image/png',
          fileName: 'gst.png',
        },
      }),
    );

    expect(result.status).toBe('PENDING_UPLOAD');
    expect(result.objectKey).toBe('vendors/vendor-1/documents/doc-1.png');
    const saved = repository.updateDocument.mock.calls[0][0];
    expect(saved.supersededObjectKey).toBe('vendors/vendor-1/documents/doc-1.pdf');
    expect(documentStorage.deleteObject).not.toHaveBeenCalled();
  });

  it('confirms an upload only after the stored object matches', async () => {
    repository.getDocument.mockResolvedValue(documentItem());
    documentStorage.headObject.mockResolvedValue({
      contentType: 'application/pdf',
      contentLength: 245678,
    });
    documentStorage.readPrefix.mockResolvedValue(pdfSignature);

    const result = await service.completevendordocumentupload(
      authRequest({ pathParameters: { documentId: 'doc-1' } }),
    );

    expect(result.status).toBe('UPLOADED');
    expect(result.downloadUrl).toBe('https://s3.example/download');
    expect(repository.updateDocument.mock.calls[0][0].status).toBe('UPLOADED');
    expect(documentStorage.headObject).toHaveBeenCalledWith({
      bucket: 'vendor-docs',
      objectKey: 'vendors/vendor-1/documents/doc-1.pdf',
    });
  });

  it('does not mark a document uploaded when the S3 object is missing', async () => {
    repository.getDocument.mockResolvedValue(documentItem());
    documentStorage.headObject.mockResolvedValue(null);

    await expect(
      service.completevendordocumentupload(
        authRequest({ pathParameters: { documentId: 'doc-1' } }),
      ),
    ).rejects.toThrow(/S3 object missing/);
    expect(repository.updateDocument).not.toHaveBeenCalled();
  });

  it('rejects confirmation when the object size or signature does not match', async () => {
    repository.getDocument.mockResolvedValue(documentItem());
    documentStorage.headObject.mockResolvedValue({
      contentType: 'application/pdf',
      contentLength: 10,
    });

    await expect(
      service.completevendordocumentupload(
        authRequest({ pathParameters: { documentId: 'doc-1' } }),
      ),
    ).rejects.toThrow(/file size does not match/);

    documentStorage.headObject.mockResolvedValue({
      contentType: 'application/pdf',
      contentLength: 245678,
    });
    documentStorage.readPrefix.mockResolvedValue(Uint8Array.from([0xff, 0xd8, 0xff]));

    await expect(
      service.completevendordocumentupload(
        authRequest({ pathParameters: { documentId: 'doc-1' } }),
      ),
    ).rejects.toThrow(/file signature/);
  });

  it('rejects confirmation after onboarding has been submitted', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ onboardingStatus: 'PENDING_REVIEW' }),
    );
    repository.getDocument.mockResolvedValue(documentItem());

    await expect(
      service.completevendordocumentupload(
        authRequest({ pathParameters: { documentId: 'doc-1' } }),
      ),
    ).rejects.toThrow(ConflictError);
    expect(documentStorage.headObject).not.toHaveBeenCalled();
  });

  it('returns a download URL for the owner and for an admin', async () => {
    repository.getDocument.mockResolvedValue(
      documentItem({ status: 'UPLOADED' }),
    );

    const owned = await service.getvendordocument(
      authRequest({ pathParameters: { documentId: 'doc-1' } }),
    );
    expect(owned.downloadUrl).toBe('https://s3.example/download');
    expect(owned.uploadUrl).toBeUndefined();

    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ ownerUserId: 'other-user' }),
    );
    const reviewed = await service.getvendordocument(
      authRequest({
        pathParameters: { documentId: 'doc-1' },
        context: { userContext: { userId: 'admin-1', roles: ['admin'] } },
      }),
    );
    expect(reviewed.documentId).toBe('doc-1');
  });

  it('does not return another vendor document to the owner', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ ownerUserId: 'other-user' }),
    );

    await expect(
      service.getvendordocument(
        authRequest({ pathParameters: { documentId: 'doc-1' } }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('deletes an editable document and its stored object', async () => {
    repository.getDocument.mockResolvedValue(documentItem());

    await service.deletevendordocument(
      authRequest({ pathParameters: { documentId: 'doc-1' } }),
    );

    expect(documentStorage.deleteObject).toHaveBeenCalledWith({
      bucket: 'vendor-docs',
      objectKey: 'vendors/vendor-1/documents/doc-1.pdf',
    });
    expect(repository.deleteDocument).toHaveBeenCalledWith('vendor-1', 'doc-1');
  });

  it('does not delete a document after onboarding is submitted', async () => {
    vendorsRepository.getVendorById.mockResolvedValue(
      vendorItem({ onboardingStatus: 'PENDING_REVIEW' }),
    );
    repository.getDocument.mockResolvedValue(
      documentItem({ status: 'UPLOADED' }),
    );

    await expect(
      service.deletevendordocument(
        authRequest({ pathParameters: { documentId: 'doc-1' } }),
      ),
    ).rejects.toThrow(ConflictError);
    expect(documentStorage.deleteObject).not.toHaveBeenCalled();
    expect(repository.deleteDocument).not.toHaveBeenCalled();
  });

  it('lists metadata and a download URL only for uploaded documents', async () => {
    repository.listDocuments.mockResolvedValue([
      documentItem({ status: 'PENDING_UPLOAD' }),
      documentItem({
        documentId: 'doc-2',
        SK: 'DOCUMENT#doc-2',
        documentType: 'BUSINESS_REGISTRATION',
        status: 'UPLOADED',
        objectKey: 'vendors/vendor-1/documents/doc-2.pdf',
      }),
    ]);

    const result = await service.listvendordocuments(authRequest());

    expect(result.data).toHaveLength(2);
    expect(result.data[0].downloadUrl).toBeUndefined();
    expect(result.data[1].downloadUrl).toBe('https://s3.example/download');
    expect(documentStorage.createDownloadUrl).toHaveBeenCalledTimes(1);
  });
});
