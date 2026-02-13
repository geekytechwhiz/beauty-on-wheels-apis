import { z } from 'zod';

export const approvePartnerBodySchema = z
  .object({
    approvedBy: z.string().min(1).max(256).optional(),
  })
  .strict()
  .optional();

export const rejectPartnerBodySchema = z
  .object({
    rejectionReason: z.string().min(1).max(1000),
  })
  .strict();

export type ApprovePartnerBody = z.infer<typeof approvePartnerBodySchema>;
export type RejectPartnerBody = z.infer<typeof rejectPartnerBodySchema>;
