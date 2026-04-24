import { z } from 'zod';

/**
 * App-level env (Lambda + serverless). Domain persistence lives in @api-hub/alert-repository / alert-integration.
 */
const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  STAGE: z.string().optional(),
  ALERT_TABLE: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export type AlertAppEnv = z.infer<typeof envSchema>;

let cached: AlertAppEnv | undefined;

export function getAlertAppEnv(): AlertAppEnv {
  if (cached) return cached;
  cached = envSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    STAGE: process.env.STAGE,
    ALERT_TABLE: process.env.ALERT_TABLE,
    LOG_LEVEL: process.env.LOG_LEVEL,
  });
  return cached;
}
