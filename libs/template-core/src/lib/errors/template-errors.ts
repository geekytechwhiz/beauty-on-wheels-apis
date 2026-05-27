export function normalizeTemplateServiceError(
  e: unknown,
  context?: { logEvent?: string; correlationId?: string },
): never {
  void context;

  if (e && typeof e === 'object' && 'statusCode' in e && 'code' in e) {
    throw e;
  }

  const err = e as Error & { name?: string; message?: string };
  if (err?.name === 'ValidationException') {
    const msg = err.message ?? 'DynamoDB query validation failed';
    const isIndexMissing = /index|Index|GSI/i.test(msg);
    const bad = new Error(msg) as Error & { statusCode: number; code: string };
    bad.statusCode = isIndexMissing ? 503 : 400;
    bad.code = isIndexMissing ? 'SERVICE_UNAVAILABLE' : 'VALIDATION_ERROR';
    throw bad;
  }

  if (err?.name === 'ResourceNotFoundException') {
    const bad = new Error(err.message ?? 'Template table or index not found') as Error & {
      statusCode: number;
      code: string;
    };
    bad.statusCode = 503;
    bad.code = 'SERVICE_UNAVAILABLE';
    throw bad;
  }

  if (
    err?.name === 'ConditionalWriteConflictError' ||
    err?.name === 'ConditionalCheckFailedException' ||
    err?.name === 'TransactionCanceledException'
  ) {
    const conflict = new Error('Master template already exists') as Error & {
      statusCode: number;
      code: string;
    };
    conflict.statusCode = 409;
    conflict.code = 'CONFLICT';
    throw conflict;
  }

  const internal = new Error(err?.message ?? 'Template service error') as Error & {
    statusCode: number;
    code: string;
  };
  internal.statusCode = 500;
  internal.code = 'INTERNAL_ERROR';
  throw internal;
}
