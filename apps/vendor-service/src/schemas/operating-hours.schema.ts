import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { SERVICE_WINDOW_IDS } from '../domain/service-windows';

/**
 * Replaces the vendor's supported service windows.
 * The persisted record is VendorOperatingPreferences, which vendor detail and onboarding read.
 */
export const UpdateVendorOperatingHoursRequestSchema = z
  .object({
    serviceWindowIds: z.array(z.enum(SERVICE_WINDOW_IDS)).max(20),
  })
  .strict();

export type UpdateVendorOperatingHoursRequest = z.infer<
  typeof UpdateVendorOperatingHoursRequestSchema
>;

export const validateUpdateVendorOperatingHoursRequest = (
  req: LambdaRequest,
): UpdateVendorOperatingHoursRequest => {
  const result = UpdateVendorOperatingHoursRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
