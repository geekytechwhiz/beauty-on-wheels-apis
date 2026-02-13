import { z } from 'zod';

const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const phonePattern = z.string().regex(/^[6-9]\d{9}$/);
const genderSchema = z.enum(['male', 'female']);

const additionalMemberSchema = z.object({
  customerName: z.string().min(3),
  nameTrue: z.boolean(),
  customerAge: z.string(),
  customerGender: genderSchema,
  packageCode: z.array(z.string()).min(1),
});

export const redcliffeCreateOrderSchema = z
  .object({
    // Base fields
    partnerId: z.string().min(1),
    patientId: z.string().min(1),
    patientName: z.string().min(3),
    testCodes: z.array(z.string()).min(1),

    // Redcliffe required fields
    bookingDate: datePattern,
    collectionDate: datePattern,
    collectionSlot: z.number().int().positive(),
    customerEmail: z.string().email(),
    customerGender: genderSchema,
    customerLatitude: z.number().min(-90).max(90),
    customerLongitude: z.number().min(-180).max(180),
    customerPhoneNumber: phonePattern,
    customerWhatsAppNumber: phonePattern,
    isCredit: z.boolean(),
    landmark: z.string().min(1),
    pincode: z.string().length(6),

    // Optional fields
    customerAddress: z.string().optional(),
    customerAge: z.string().optional(),
    customerAltPhoneNumber: phonePattern.optional(),
    referenceData: z.string().optional(),
    additionalMember: z.array(additionalMemberSchema).optional(),
  })
  .strict();

export type RedcliffeCreateOrderInput = z.infer<
  typeof redcliffeCreateOrderSchema
>;
