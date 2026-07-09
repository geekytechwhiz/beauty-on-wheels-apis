import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(3).max(100),

  password: z.string().min(8).max(128),

  deviceId: z.string().uuid().optional(),

  rememberMe: z.boolean().default(false),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>; 
