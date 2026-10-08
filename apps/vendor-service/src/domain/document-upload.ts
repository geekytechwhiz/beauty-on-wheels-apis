import { ConflictError, ValidationError } from '@api-hub/utils';

import { env } from '../configs/env.config';
import { DocumentType } from '../types/api-types';
import {
  DOCUMENT_STATUS,
  DOCUMENT_TYPE,
  ONBOARDING_STATUS,
  REQUIRED_DOCUMENT_TYPES,
} from './onboarding';

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

export interface ParsedDocumentUpload {
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface DocumentPresence {
  documentType: string;
  status: string;
}

const DOCUMENT_TYPE_VALUES = new Set<string>(Object.values(DOCUMENT_TYPE));

export function assertDocumentsMutable(onboardingStatus: string): void {
  if (
    onboardingStatus === ONBOARDING_STATUS.DRAFT ||
    onboardingStatus === ONBOARDING_STATUS.IN_PROGRESS
  ) {
    return;
  }

  throw new ConflictError(
    `Documents cannot be changed while onboarding status is ${onboardingStatus}`,
  );
}

export function extensionForContentType(contentType: string): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[normalizeContentType(contentType)];
  if (!extension) {
    throw new ValidationError('Unsupported content type', [
      {
        field: 'contentType',
        message: `Supported content types: ${env.DOCUMENT_ALLOWED_CONTENT_TYPES.join(', ')}`,
      },
    ]);
  }
  return extension;
}

export function createDocumentObjectKey(
  vendorId: string,
  documentId: string,
  contentType: string,
): string {
  if (!SAFE_SEGMENT.test(vendorId) || !SAFE_SEGMENT.test(documentId)) {
    throw new ValidationError('Document object key could not be created');
  }

  const extension = extensionForContentType(contentType);
  return `vendors/${vendorId}/documents/${documentId}.${extension}`;
}

export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop()?.trim() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 255);

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new ValidationError('Invalid file name', [
      { field: 'fileName', message: 'File name is empty or invalid' },
    ]);
  }

  return cleaned;
}

export function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function parseDocumentUploadRequest(input: unknown): ParsedDocumentUpload {
  const body =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const documentType = body.documentType;
  if (typeof documentType !== 'string' || !DOCUMENT_TYPE_VALUES.has(documentType)) {
    throw new ValidationError('Unsupported document type', [
      {
        field: 'documentType',
        message: `Supported document types: ${Object.values(DOCUMENT_TYPE).join(', ')}`,
      },
    ]);
  }

  if (typeof body.fileName !== 'string' || body.fileName.trim().length === 0) {
    throw new ValidationError('Invalid file name', [
      { field: 'fileName', message: 'File name is required' },
    ]);
  }

  const contentType =
    typeof body.contentType === 'string' ? normalizeContentType(body.contentType) : '';
  if (!env.DOCUMENT_ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new ValidationError('Unsupported content type', [
      {
        field: 'contentType',
        message: `Supported content types: ${env.DOCUMENT_ALLOWED_CONTENT_TYPES.join(', ')}`,
      },
    ]);
  }

  const fileSize = body.fileSize;
  if (typeof fileSize !== 'number' || !Number.isInteger(fileSize) || fileSize <= 0) {
    throw new ValidationError('Invalid file size', [
      { field: 'fileSize', message: 'fileSize must be a positive integer' },
    ]);
  }
  if (fileSize > env.DOCUMENT_MAX_FILE_SIZE) {
    throw new ValidationError('File exceeds the maximum allowed size', [
      {
        field: 'fileSize',
        message: `Maximum file size is ${env.DOCUMENT_MAX_FILE_SIZE} bytes`,
      },
    ]);
  }

  return {
    documentType: documentType as DocumentType,
    fileName: sanitizeFileName(body.fileName),
    contentType,
    fileSize,
  };
}

export function contentTypeMatchesSignature(
  contentType: string,
  bytes: Uint8Array,
): boolean {
  const normalized = normalizeContentType(contentType);
  if (normalized === 'application/pdf') {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    );
  }
  if (normalized === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (normalized === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return false;
}

export function acceptedDocumentTypes(
  documents: Iterable<DocumentPresence>,
): string[] {
  const uploaded: string[] = [];
  for (const document of documents) {
    if (document.status === DOCUMENT_STATUS.UPLOADED) {
      uploaded.push(document.documentType);
    }
  }
  return uploaded;
}

export function requiredDocumentGaps(documents: Iterable<DocumentPresence>): {
  missing: string[];
  notUploaded: string[];
} {
  const byType = new Map<string, string>();
  for (const document of documents) {
    byType.set(document.documentType, document.status);
  }

  const missing: string[] = [];
  const notUploaded: string[] = [];
  for (const type of REQUIRED_DOCUMENT_TYPES) {
    const status = byType.get(type);
    if (!status) {
      missing.push(type);
    } else if (status !== DOCUMENT_STATUS.UPLOADED) {
      notUploaded.push(type);
    }
  }
  return { missing, notUploaded };
}

export function documentBelongsToVendor(vendorId: string, objectKey: string): boolean {
  const prefix = `vendors/${vendorId}/documents/`;
  return objectKey.startsWith(prefix) && !objectKey.includes('..');
}
