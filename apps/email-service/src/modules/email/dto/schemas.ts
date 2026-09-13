import { z } from 'zod';

const emailZ = z.email();

const adhocAttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string(), // Base64
  contentType: z.string(),
});

export const sendAdhocEmailSchema = z.strictObject({
  to: z.union([emailZ, z.array(emailZ).min(1)]),
  from: emailZ,
  fromName: z.string().optional(),
  subject: z.string().min(1).max(256).optional(),
  htmlContent: z.string().optional(),
  textContent: z.string().optional(),
  templateName: z.string().optional(),
  templateData: z.record(z.string(), z.unknown()).optional(),
  cc: z.array(emailZ).optional(),
  bcc: z.array(emailZ).optional(),
  replyTo: z.array(emailZ).optional(),
  attachments: z.array(adhocAttachmentSchema).optional(),
  contactListName: z.string().optional(),
  topicName: z.string().optional(),
});

export type SendAdhocEmailInput = z.infer<typeof sendAdhocEmailSchema>;
