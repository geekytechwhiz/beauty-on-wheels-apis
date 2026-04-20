import { z } from 'zod';

export const userCreatedEventSchema = z.object({
  eventName: z.literal('UserCreated.v1'),
  correlationId: z.string(),
  userId: z.string(),
  organizationID: z.string().optional(),
  roleId: z.string().optional(),
  email: z.union([z.email(), z.literal('')]),
  phone: z.string().optional(),
  name: z.string(),
  profilePic: z.string().optional(),
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
