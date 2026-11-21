import { z } from 'zod';

import { VendorHomeSummarySchema } from '../domain/vendor-home-summary';

/** Query contract shared with OpenAPI / Postman. */
export const VendorHomeSummaryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  upcomingDays: z.string().regex(/^[1-7]$/).optional(),
}).strict();

export { VendorHomeSummarySchema };
