import {
  SESv2Client,
  CreateEmailTemplateCommand,
  GetEmailTemplateCommand,
  DeleteEmailTemplateCommand,
  ListEmailTemplatesCommand,
} from '@aws-sdk/client-sesv2';
import {
  ITemplateRegistryProvider,
  EmailTemplate,
  EmailTemplateMetadata,
} from '../ITemplateRegistryProvider.js';
import { logger } from '../../utils/logger.js';

import { environment } from '../../config/environment.js';

export class SesTemplateRegistryProvider implements ITemplateRegistryProvider {
  private client: SESv2Client;

  constructor(region: string) {
    const config: any = { region };
    if (environment.isOffline) {
      config.endpoint = environment.sesEndpoint;
      config.credentials = { accessKeyId: 'local', secretAccessKey: 'local' };
    }
    this.client = new SESv2Client(config);
  }

  async createTemplate(template: EmailTemplate): Promise<void> {
    try {
      const command = new CreateEmailTemplateCommand({
        TemplateName: template.templateName,
        TemplateContent: {
          Subject: template.subject,
          ...(template.htmlContent ? { Html: template.htmlContent } : {}),
          ...(template.textContent ? { Text: template.textContent } : {}),
        },
      });
      await this.client.send(command);
    } catch (error) {
      logger.error('Error creating SES template', { error, templateName: template.templateName });
      throw error;
    }
  }

  async getTemplate(templateName: string): Promise<EmailTemplate> {
    try {
      const command = new GetEmailTemplateCommand({
        TemplateName: templateName,
      });
      const response = await this.client.send(command);

      return {
        templateName: response.TemplateName || templateName,
        subject: response.TemplateContent?.Subject || '',
        htmlContent: response.TemplateContent?.Html,
        textContent: response.TemplateContent?.Text,
      };
    } catch (error) {
      logger.error('Error fetching SES template', { error, templateName });
      throw error;
    }
  }

  async deleteTemplate(templateName: string): Promise<void> {
    try {
      const command = new DeleteEmailTemplateCommand({
        TemplateName: templateName,
      });
      await this.client.send(command);
    } catch (error) {
      logger.error('Error deleting SES template', { error, templateName });
      throw error;
    }
  }

  async listTemplates(): Promise<EmailTemplateMetadata[]> {
    const templates: EmailTemplateMetadata[] = [];
    let nextToken: string | undefined;

    try {
      do {
        const command = new ListEmailTemplatesCommand({
          NextToken: nextToken,
        });
        const response = await this.client.send(command);

        for (const meta of response.TemplatesMetadata || []) {
          if (meta.TemplateName) {
            templates.push({
              Name: meta.TemplateName,
              CreatedTimestamp: meta.CreatedTimestamp,
            });
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      return templates;
    } catch (error) {
      logger.error('Error listing SES templates', { error });
      throw error;
    }
  }
}
