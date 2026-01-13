import { z } from 'zod';

export const userCreatedEventSchema = z.object({
  eventName: z.literal('UserCreated.v1'),
  correlationId: z.string(),
  userId: z.string(),
  email: z.union([z.email(), z.literal('')]),
  name: z.string(),
});

export const userProfileUpdatedEventSchema = z.object({
  eventName: z.literal('UserProfileUpdated.v1'),
  correlationId: z.string(), 
  changes: z.record(z.string(), z.any()),
});

export const userDeletedEventSchema = z.object({
  eventName: z.literal('UserDeleted.v1'),
  correlationId: z.string(),
  userId: z.string().uuid(),
});
