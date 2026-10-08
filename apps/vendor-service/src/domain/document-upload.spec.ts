import { ConflictError, ValidationError } from '@api-hub/utils';

import {
  acceptedDocumentTypes,
  assertDocumentsMutable,
  contentTypeMatchesSignature,
  createDocumentObjectKey,
  parseDocumentUploadRequest,
  requiredDocumentGaps,
  sanitizeFileName,
} from './document-upload';

const validUpload = {
  documentType: 'GST_REGISTRATION',
  fileName: 'gst-certificate.pdf',
  contentType: 'application/pdf',
  fileSize: 245678,
};

describe('parseDocumentUploadRequest', () => {
  it('accepts a supported onboarding document', () => {
    expect(parseDocumentUploadRequest(validUpload)).toEqual(validUpload);
  });

  it('rejects an unsupported document type', () => {
    expect(() =>
      parseDocumentUploadRequest({ ...validUpload, documentType: 'TRADE_LICENSE' }),
    ).toThrow(ValidationError);
  });

  it('rejects an unsupported content type', () => {
    expect(() =>
      parseDocumentUploadRequest({ ...validUpload, contentType: 'text/plain' }),
    ).toThrow(/Unsupported content type/);
  });

  it('rejects an oversized file', () => {
    expect(() =>
      parseDocumentUploadRequest({ ...validUpload, fileSize: 10 * 1024 * 1024 + 1 }),
    ).toThrow(/maximum allowed size/);
  });

  it('stores a sanitized file name and ignores a client object key', () => {
    const parsed = parseDocumentUploadRequest({
      ...validUpload,
      fileName: '../../gst certificate.pdf',
      objectKey: 'vendors/other/secret.pdf',
    });

    expect(parsed.fileName).toBe('gst certificate.pdf');
    expect(parsed).not.toHaveProperty('objectKey');
  });
});

describe('createDocumentObjectKey', () => {
  it('scopes the key to the vendor and document id', () => {
    expect(
      createDocumentObjectKey('vendor-1', 'doc-1', 'application/pdf'),
    ).toBe('vendors/vendor-1/documents/doc-1.pdf');
  });

  it('rejects path segments in the vendor id', () => {
    expect(() =>
      createDocumentObjectKey('../other', 'doc-1', 'application/pdf'),
    ).toThrow(ValidationError);
  });
});

describe('sanitizeFileName', () => {
  it('drops directory segments', () => {
    expect(sanitizeFileName('folder/../../gst.pdf')).toBe('gst.pdf');
  });
});

describe('contentTypeMatchesSignature', () => {
  it('recognizes pdf, jpeg, and png signatures', () => {
    expect(
      contentTypeMatchesSignature(
        'application/pdf',
        Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
      ),
    ).toBe(true);
    expect(
      contentTypeMatchesSignature('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe(true);
    expect(
      contentTypeMatchesSignature(
        'image/png',
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    expect(
      contentTypeMatchesSignature('application/pdf', Uint8Array.from([0xff, 0xd8, 0xff])),
    ).toBe(false);
  });
});

describe('requiredDocumentGaps', () => {
  it('reports missing and not-yet-uploaded required documents', () => {
    expect(
      requiredDocumentGaps([
        { documentType: 'GST_REGISTRATION', status: 'PENDING_UPLOAD' },
        { documentType: 'BUSINESS_REGISTRATION', status: 'UPLOADED' },
      ]),
    ).toEqual({
      missing: ['COMMERCIAL_INSURANCE'],
      notUploaded: ['GST_REGISTRATION'],
    });
  });

  it('counts only uploaded documents toward completeness', () => {
    expect(
      acceptedDocumentTypes([
        { documentType: 'GST_REGISTRATION', status: 'PENDING_UPLOAD' },
        { documentType: 'BUSINESS_REGISTRATION', status: 'UPLOADED' },
      ]),
    ).toEqual(['BUSINESS_REGISTRATION']);
  });
});

describe('assertDocumentsMutable', () => {
  it('allows draft and in-progress onboarding', () => {
    expect(() => assertDocumentsMutable('DRAFT')).not.toThrow();
    expect(() => assertDocumentsMutable('IN_PROGRESS')).not.toThrow();
  });

  it('blocks changes after the application is submitted', () => {
    expect(() => assertDocumentsMutable('PENDING_REVIEW')).toThrow(ConflictError);
  });
});
