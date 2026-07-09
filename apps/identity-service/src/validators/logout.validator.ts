import { z } from 'zod';

export const LogoutRequestSchema = z.object({
  sessionId: z.string().uuid(),

  logoutAllDevices: z.boolean().default(false),
});

export type LogoutRequest = z.infer<typeof LogoutRequestSchema>; 
