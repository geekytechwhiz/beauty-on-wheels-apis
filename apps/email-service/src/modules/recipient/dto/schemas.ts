import { z } from 'zod';

export const createGroupSchema = z.strictObject({
  tableName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  recipients: z
    .array(
      z.object({
        email: z.email(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        topics: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

// Non-strict: API Gateway may add extra query params.
export const getUploadUrlSchema = z.object({
  filename: z.string().min(1).max(255),
});

export type GetUploadUrlInput = z.infer<typeof getUploadUrlSchema>;
