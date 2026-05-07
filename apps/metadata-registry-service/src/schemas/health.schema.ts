import { z } from 'zod';

/** Health check accepts any Lambda request shape; validates only that input is an object. */
export const healthRequestSchema = z.object({}).passthrough();

export type HealthRequest = z.infer<typeof healthRequestSchema>;
