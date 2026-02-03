import type { Handler } from 'aws-lambda';
import { logAuditEvent } from '../events/auditEvent';

export const handler: Handler = async (event) => {
  await logAuditEvent(event as unknown as Parameters<typeof logAuditEvent>[0]);
  return { statusCode: 204 };
};
