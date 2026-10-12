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
  totalAmount: z.number().optional(),
  paymentMethod: z.string().optional(),
  paymentStatus: z.enum(["PENDING", "PAID", "REFUNDED"]).optional(),
  bookingStatus: z.enum(["CREATED", "PENDING", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional()
}).strict();

const fulfilmentTypeSchema = z
  .enum(["community", "address", "COMMUNITY", "ADDRESS"])
  .transform((value) => value.toLowerCase() as "community" | "address");

export const CreateBookingSchema = z.object({
  vendorId: z.string().trim().min(1),
  branchId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1),
  offeringId: z.string().trim().min(1),
  offeringVersion: z.number().int().positive(),
  slotId: z.string().trim().min(1),
  holdId: z.string().trim().min(1),
  location: z.object({
    fulfilmentType: fulfilmentTypeSchema,
    communityId: z.string().trim().min(1).optional(),
    addressId: z.string().trim().min(1).optional(),
  }).strict(),
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
