import { z } from 'zod';

/**
 * App-level runtime env for template-service.
 * Domain/persistence config remains in shared libs.
 */
const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  STAGE: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_DEFAULT_REGION: z.string().optional(),
  AWS_REGION_TEMPLATE_SERVICE: z.string().optional(),
  TEMPLATE_UI_BUCKET: z.string().optional(),
  USER_TABLE: z.string().optional(),
  FILE_BUCKET: z.string().optional(),
});

export type TemplateAppEnv = z.infer<typeof envSchema>;

let cached: TemplateAppEnv | undefined;

export function getTemplateAppEnv(): TemplateAppEnv {
  if (cached) return cached;
  cached = envSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    STAGE: process.env.STAGE,
    AWS_REGION: process.env.AWS_REGION,
    AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
    AWS_REGION_TEMPLATE_SERVICE: process.env.AWS_REGION_TEMPLATE_SERVICE,
    TEMPLATE_UI_BUCKET: process.env.TEMPLATE_UI_BUCKET,
    USER_TABLE: process.env.USER_TABLE,
    FILE_BUCKET: process.env.FILE_BUCKET,
  });
  return cached;
}
