export function normalizeTemplateServiceError(
  e: unknown,
  context?: { logEvent?: string; correlationId?: string },
): never {
  if (e && typeof e === 'object' && 'statusCode' in e && 'code' in e) {
    throw e;
  }

  const err = e as Error & { name?: string };
  if (err?.name === 'ConditionalCheckFailedException' || err?.name === 'TransactionCanceledException') {
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
