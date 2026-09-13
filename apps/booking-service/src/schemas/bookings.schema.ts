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

export type Booking =
    z.infer<typeof BookingSchema>;

export const validateBooking = (req: LambdaRequest): Booking => {
    const result = BookingSchema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};
