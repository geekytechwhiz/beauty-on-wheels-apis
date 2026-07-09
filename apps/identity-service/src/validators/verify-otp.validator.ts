import { z } from 'zod';

export const VerifyOtpRequestSchema = z.object({
  referenceId: z.string().uuid(),

  otp: z.string().regex(/^\d{6}$/),
});

export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequestSchema>;

