import { z } from 'zod';

export const userCreatedDataSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  organizationId: z.string().min(1, 'organizationId is required'),
  email: z.string().optional(),
  fullName: z.string().optional(),
  firstName: z.string().optional(),
  correlationId: z.string().optional(),
}).passthrough();

export const userCreatedEventSchema = userCreatedDataSchema;;

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

export const userRoleAssignmentRequestedEventSchema = z.object({
  eventName: z.literal('UserRoleAssignmentRequested.v1'),
  correlationId: z.string(),
  organizationID: z.string(),
  roleId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.union([z.email(), z.literal('')]),
  phone: z.string().optional(),
  profilePic: z.string().optional(),
  authHeader: z.string().optional(),
});
