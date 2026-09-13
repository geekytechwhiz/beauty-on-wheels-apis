export interface EmailTemplate {
  templateName: string;
  subject: string;
  htmlContent?: string;
  textContent?: string;
}

export interface EmailTemplateMetadata {
  Name: string;
  CreatedTimestamp?: Date;
}

export interface ITemplateRegistryProvider {
  createTemplate(template: EmailTemplate): Promise<void>;
  getTemplate(templateName: string): Promise<EmailTemplate>;
  deleteTemplate(templateName: string): Promise<void>;
  listTemplates(): Promise<EmailTemplateMetadata[]>;
}
