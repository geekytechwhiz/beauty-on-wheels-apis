import { z } from 'zod';

import { VendorOperationsSummarySchema } from '../domain/vendor-operations-summary';

/** Query contract shared with OpenAPI / Postman. Both dates are required. */
export const VendorOperationsSummaryQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export { VendorOperationsSummarySchema };
