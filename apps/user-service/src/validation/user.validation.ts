import { z } from 'zod';

export const createUserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
});

export const updateUserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

export const assignUserToOrganizationSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

export const updateUserMetadataSchema = z.object({
  userId: z.string().uuid(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.object({})]),
  ),
});

export const userFileReferenceSchema = z.object({
  userId: z.string().uuid(),
  fileId: z.string().uuid(),
  fileName: z.string(),
  s3Key: z.string(),
  uploadedAt: z.string(),
});

export const s3EventSchema = z.object({
  Records: z.array(
    z.object({
      s3: z.object({
        bucket: z.object({ name: z.string() }),
        object: z.object({ key: z.string() }),
      }),
    }),
  ),
});

export const sqsEventSchema = z.object({
  Records: z.array(
    z.object({
      messageId: z.string(),
      body: z.string(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

