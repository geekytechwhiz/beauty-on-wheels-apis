import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { z } from 'zod';

import {
  assertCatalogAmount,
  assertCatalogName,
  assertPositiveDuration,
} from '../domain/catalog-validation';
import { ADDON_SUGGESTION_REVIEW_ACTION } from '../domain/addon-suggestion';

export const CreateAddonSuggestionSchema = z.object({
  vendorId: z.string().trim().min(1),
  categoryId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  durationMinutes: z.number(),
  proposedCustomerPriceMinor: z.number().int().nonnegative().optional(),
  packageCompatibilityNotes: z.string().trim().max(1000).optional(),
}).strict();

export const ReviewAddonSuggestionSchema = z.object({
  action: z.enum([
    ADDON_SUGGESTION_REVIEW_ACTION.REQUEST_CHANGES,
    ADDON_SUGGESTION_REVIEW_ACTION.APPROVE,
    ADDON_SUGGESTION_REVIEW_ACTION.REJECT,
  ]),
  note: z.string().trim().max(2000).optional(),
}).strict();

export type CreateAddonSuggestionInput = z.infer<typeof CreateAddonSuggestionSchema>;
export type ReviewAddonSuggestionInput = z.infer<typeof ReviewAddonSuggestionSchema>;

export function validateCreateAddonSuggestion(req: LambdaRequest): CreateAddonSuggestionInput {
  const result = CreateAddonSuggestionSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  const name = assertCatalogName(result.data.name);
  assertPositiveDuration(result.data.durationMinutes);
  if (result.data.proposedCustomerPriceMinor !== undefined) {
    assertCatalogAmount(result.data.proposedCustomerPriceMinor, 'proposedCustomerPriceMinor');
  }
  return {
    ...result.data,
    vendorId: result.data.vendorId.trim(),
    name,
  };
}

export function validateReviewAddonSuggestion(req: LambdaRequest): ReviewAddonSuggestionInput {
  const result = ReviewAddonSuggestionSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  return result.data;
}
