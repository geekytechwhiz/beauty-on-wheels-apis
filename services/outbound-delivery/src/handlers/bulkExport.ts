import type { Handler } from 'aws-lambda';
import { startBulkExport } from '../bulk-export';

export const handler: Handler = async (event) => {
  const body = typeof event.body === 'string' ? JSON.parse(event.body ?? '{}') : event.body ?? {};
  const result = await startBulkExport(body);
  return { statusCode: 202, body: JSON.stringify(result) };
};
