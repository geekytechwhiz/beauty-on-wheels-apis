import { z } from 'zod';

/**
 * Validation schema for POST /organization/users endpoint
 * 
 * Supports two scenarios:
 * 1. Filter by type: { "organizationID": "...", "type": "STAFF" }
 * 2. Apply limit: { "organizationID": "...", "limit": 10 }
 */
export const listOrganizationUsersPostSchema = z.object({
  organizationID: z.string().min(1, 'organizationID is required'),
  limit: z.number().int().positive().max(1000).optional(),
  type: z.enum(['STAFF', 'USER', 'FNF']).optional(),
});

export type ListOrganizationUsersPostRequest = z.infer<typeof listOrganizationUsersPostSchema>;
