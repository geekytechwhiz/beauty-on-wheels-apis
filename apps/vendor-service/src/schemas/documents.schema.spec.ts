import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import {
  validateCreateDocumentRequest,
  validateUpdateDocumentRequest,
} from './documents.schema';

function request(body: unknown): LambdaRequest {
  return { body } as LambdaRequest;
}

const validBody = {
  documentType: 'GST_REGISTRATION',
  fileName: 'gst-certificate.pdf',
  contentType: 'application/pdf',
  fileSize: 245678,
};

describe('document request schemas', () => {
  it('accepts a valid upload request', () => {
    expect(validateCreateDocumentRequest(request(validBody))).toEqual(validBody);
  });

  it('rejects a client-supplied object key', () => {
    expect(() =>
      validateCreateDocumentRequest(
        request({ ...validBody, objectKey: 'vendors/other/secret.pdf' }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('rejects an unsupported document type', () => {
    expect(() =>
      validateCreateDocumentRequest(
        request({ ...validBody, documentType: 'TRADE_LICENSE' }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('rejects an unsupported content type', () => {
    expect(() =>
      validateCreateDocumentRequest(
        request({ ...validBody, contentType: 'application/zip' }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('rejects an oversized file', () => {
    expect(() =>
      validateCreateDocumentRequest(
        request({ ...validBody, fileSize: 10 * 1024 * 1024 + 1 }),
      ),
    ).toThrow(EventSchemaError);
  });

  it('rejects an object key on document replacement', () => {
    expect(() =>
      validateUpdateDocumentRequest(
        request({ fileName: 'gst.pdf', objectKey: 'evil/key.pdf' }),
      ),
    ).toThrow(EventSchemaError);
  });
});
