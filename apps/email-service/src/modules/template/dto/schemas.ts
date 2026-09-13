import { z } from 'zod';

export const createTemplateSchema = z.strictObject({
  templateName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  subject: z.string().min(1).max(256),
  htmlContent: z.string().optional(),
  textContent: z.string().optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const createMultipleTemplatesSchema = z
  .array(createTemplateSchema)
  .min(1)
  .max(50)
  .superRefine((templates, ctx) => {
    const seen = new Set<string>();
    templates.forEach((template, index) => {
      if (seen.has(template.templateName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate templateName '${template.templateName}' in request`,
          path: [index, 'templateName'],
        });
        return;
      }
      seen.add(template.templateName);
    });
  });

export type CreateMultipleTemplatesInput = z.infer<typeof createMultipleTemplatesSchema>;
