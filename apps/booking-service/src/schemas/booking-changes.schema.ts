import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

export const BOOKING_CHANGE_TYPES = ['PROVIDER', 'SERVICE'] as const;

/**
 * Shared by `POST /bookings/{bookingId}/changes/preview` and
 * `POST /bookings/{bookingId}/changes`. `expectedPrice` is optional on preview
 * and required on commit (enforced by the service).
 */
export const BookingChangeSchema = z.object({
  changeType: z.enum(BOOKING_CHANGE_TYPES),
  vendorId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  offeringId: z.string().trim().min(1),
  schedule: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:mm'),
    timezone: z.string().trim().min(1),
  }).strict(),
  expectedPrice: z.object({
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
  }).strict().optional(),
  holdId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, context) => {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value.schedule.timezone });
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule', 'timezone'],
      message: 'timezone must be a valid IANA time zone',
    });
  }
  const [year, month, day] = value.schedule.date.split('-').map(Number);
  const civilDate = new Date(Date.UTC(year, month - 1, day));
  if (civilDate.getUTCFullYear() !== year || civilDate.getUTCMonth() !== month - 1 || civilDate.getUTCDate() !== day) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'date'], message: 'date must be a real calendar date' });
  }
  const [hour, minute] = value.schedule.startTime.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'startTime'], message: 'startTime must be a valid HH:mm time' });
  }
});

export type BookingChangeCommand = z.infer<typeof BookingChangeSchema>;

export const validateBookingChange = (req: LambdaRequest): BookingChangeCommand => {
  const result = BookingChangeSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};
