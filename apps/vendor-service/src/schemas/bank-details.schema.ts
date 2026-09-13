import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

export const BankDetailsDataSchema = z
  .object({
    accountHolderName: z.string().min(2).max(150),
    accountNumber: z.string().min(8).max(18).regex(/^\d+$/),
    ifscCode: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
    bankName: z.string().min(2).max(150),
    branchName: z.string().max(150).optional(),
    accountType: z.enum(['SAVINGS', 'CURRENT']).optional(),
  })
  .strict();

export const validateBankDetailsRequest = (req: LambdaRequest) => {
  const result = BankDetailsDataSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
};
