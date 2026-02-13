import type { Handler } from 'aws-lambda';
import { logProvenance } from '../events/provenance';

export const handler: Handler = async (event) => {
  await logProvenance(event as unknown as Parameters<typeof logProvenance>[0]);
  return { statusCode: 204 };
};
