export type ListCompatibleTemplatesParams = {
  condition: string;
  country: string;
  duration?: string;
  templateType?: string;
  limit?: number;
};

export interface CompatibleTemplateItem {
  templateId: string;
  templateVersionId: string;
  templateName?: string;
  templateType?: string;
  condition?: string;
  countries?: string[];
  duration?: string;
  status: string;
  publishedAt?: string | null;
}
