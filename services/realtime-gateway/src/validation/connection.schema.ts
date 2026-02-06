import { z } from 'zod';

/** authType: jwt | oauth (default jwt). Determines which auth provider is used. */
export const connectionQuerySchema = z.object({
  token: z.string().min(1).optional(),
  authType: z.enum(['jwt', 'oauth']).optional(),
  userId: z.string().min(1).optional(),
  orgId: z.string().min(1).optional(),
  roles: z.string().optional(),
});

export type ConnectionQuery = z.infer<typeof connectionQuerySchema>;
