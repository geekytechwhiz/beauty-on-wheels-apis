import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";

/**
 * ---------------------------------------------------------
 * Booking
 * ---------------------------------------------------------
 */

export const VehicleDetailsSchema = z.object({
  bodyCategory: z.string().optional(),
  makeModel: z.string().optional(),
  saveToGarage: z.boolean().optional(),
}).strict();

export const BookingSchema = z.object({
  id: z.string().optional(),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  vehicleId: z.string().optional(),
  vehicleDetails: VehicleDetailsSchema.optional(),
  serviceIds: z.array(z.string()).optional(),
  bookingDate: z.string().optional(),
  slotId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  totalAmount: z.number().optional(),
  paymentMethod: z.string().optional(),
  paymentStatus: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED"]).optional(),
  bookingStatus: z.enum(["CREATED", "PENDING", "PENDING_PAYMENT", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional()
}).strict();

const fulfilmentTypeSchema = z
  .enum(["community", "address", "COMMUNITY", "ADDRESS"])
  .transform((value) => value.toLowerCase() as "community" | "address");

export const CreateBookingSchema = z.object({
  vendorId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1),
  offeringId: z.string().trim().min(1),
  schedule: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'startTime must be HH:mm'),
    timezone: z.string().trim().min(1),
  }).strict(),
  location: z.object({
    fulfilmentType: fulfilmentTypeSchema,
    communityId: z.string().trim().min(1).optional(),
    addressId: z.string().trim().min(1).optional(),
  }).strict(),
  addOnIds: z.array(z.string().trim().min(1)).default([]),
  expectedPrice: z.object({
    totalMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
  }).strict(),
  notes: z.string().trim().max(2000).optional(),
  holdId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, context) => {
  if (value.location.fulfilmentType === "community" && !value.location.communityId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["location", "communityId"],
      message: "communityId is required when fulfilmentType is community",
    });
  }
  if (value.location.fulfilmentType === "address" && !value.location.addressId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["location", "addressId"],
      message: "addressId is required when fulfilmentType is address",
    });
  }
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
  if (new Set(value.addOnIds).size !== value.addOnIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['addOnIds'],
      message: 'addOnIds must not contain duplicates',
    });
  }
});

export type CreateBookingCommand = z.infer<typeof CreateBookingSchema>;

export type Booking =
    z.infer<typeof BookingSchema>;

export const validateBooking = (req: LambdaRequest): Booking => {
    const result = BookingSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};

export const validateCreateBooking = (req: LambdaRequest): CreateBookingCommand => {
    const result = CreateBookingSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
