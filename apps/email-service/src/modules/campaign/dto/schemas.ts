import { z } from 'zod';

export const initiateCampaignSchema = z.strictObject({
  campaignName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  templateName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  groupId: z.string().optional(),
  // Kept for compatibility with React UI (which sends selected group in recipientListFile)
  recipientListFile: z.string().optional(),
  senderEmail: z.email(),
  senderName: z.string().max(256),
  topicName: z.string().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        content: z.string(), // Base64
        contentType: z.string(),
      }),
    )
    .optional(),
});

export type InitiateCampaignInput = z.infer<typeof initiateCampaignSchema>;
