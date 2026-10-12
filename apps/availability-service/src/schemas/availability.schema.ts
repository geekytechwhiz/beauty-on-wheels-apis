import { z } from 'zod';
import { LambdaRequest, ValidationError } from '@api-hub/utils';

import { DAY_OF_WEEK } from '../domain/constants';

const intervalSchema = z.object({
  dayOfWeek: z.enum(DAY_OF_WEEK),
  closed: z.boolean().optional(),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
});

export const WorkingHoursSchema = z
  .object({
    vendorId: z.string().optional(),
    branchId: z.string().optional(),
    timezone: z.string().optional(),
    dayOfWeek: z.enum(DAY_OF_WEEK).optional(),
    openTime: z.string().optional(),
    closeTime: z.string().optional(),
    closed: z.boolean().optional(),
    hours: z.array(intervalSchema).optional(),
  })
  .strict();

export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

export const validateWorkingHours = (req: LambdaRequest): WorkingHours => {
  const result = WorkingHoursSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(
      'Request validation failed',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
};
