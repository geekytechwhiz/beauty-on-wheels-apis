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
