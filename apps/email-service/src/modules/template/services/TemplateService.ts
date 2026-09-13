import {
  ITemplateRegistryProvider,
  EmailTemplate,
  EmailTemplateMetadata,
} from '../../../common/providers/ITemplateRegistryProvider.js';
import { CreateMultipleTemplatesInput, CreateTemplateInput } from '../dto/schemas.js';
import { environment } from '../../../common/config/environment.js';
import { logger } from '../../../common/utils/logger.js';

export type CreateTemplateFailure = {
  templateName: string;
  message: string;
  code: string;
};

export type CreateMultipleTemplatesResult = {
  successList: string[];
  failedList: CreateTemplateFailure[];
};

export class TemplateService {
  private registry: ITemplateRegistryProvider;

  constructor(registry: ITemplateRegistryProvider) {
    this.registry = registry;
  }

  async listTemplates(): Promise<EmailTemplateMetadata[]> {
    logger.info('Listing all email templates');
    return this.registry.listTemplates();
  }

  async getTemplate(templateName: string): Promise<EmailTemplate> {
    logger.info(`Fetching email template: ${templateName}`);
    return this.registry.getTemplate(templateName);
  }

  async deleteTemplate(templateName: string): Promise<void> {
    logger.info(`Deleting email template: ${templateName}`);
    await this.registry.deleteTemplate(templateName);
  }

  async createTemplate(input: CreateTemplateInput): Promise<void> {
    logger.info(`Creating email template: ${input.templateName}`);

    let htmlContent = input.htmlContent || '';
    let textContent = input.textContent || '';

    // Only inject SES list-management unsubscribe when a contact list is configured.
    // Without ListManagementOptions on send, {{amazonSESUnsubscribeUrl}} breaks delivery.
    const shouldInjectUnsubscribe = Boolean(environment.contactListName);

    if (shouldInjectUnsubscribe) {
      if (htmlContent && !htmlContent.includes('{{amazonSESUnsubscribeUrl}}')) {
        const unsubscribeHtml =
          '<p>To unsubscribe from this newsletter, <a href="{{amazonSESUnsubscribeUrl}}">click here</a>.</p>';

        if (htmlContent.includes('</body>')) {
          htmlContent = htmlContent.replace('</body>', `${unsubscribeHtml}</body>`);
        } else {
          htmlContent += unsubscribeHtml;
        }
      }

      if (textContent && !textContent.includes('{{amazonSESUnsubscribeUrl}}')) {
        const unsubscribeText =
          '\n\nTo unsubscribe from this newsletter, visit: {{amazonSESUnsubscribeUrl}}';
        textContent += unsubscribeText;
      }
    } else {
      logger.info(
        'Skipping unsubscribe auto-inject because CONTACT_LIST_NAME / contactListName is not configured',
        { templateName: input.templateName },
      );
    }

    await this.registry.createTemplate({
      templateName: input.templateName,
      subject: input.subject,
      ...(htmlContent ? { htmlContent } : {}),
      ...(textContent ? { textContent } : {}),
    });
  }

  async createMultipleTemplates(
    inputs: CreateMultipleTemplatesInput,
  ): Promise<CreateMultipleTemplatesResult> {
    logger.info(`Creating ${inputs.length} email templates`);

    const successList: string[] = [];
    const failedList: CreateTemplateFailure[] = [];

    for (const input of inputs) {
      try {
        await this.createTemplate(input);
        successList.push(input.templateName);
      } catch (error: any) {
        const code =
          error?.name === 'AlreadyExistsException'
            ? 'CONFLICT'
            : error?.name || 'CREATE_FAILED';
        const message =
          error?.name === 'AlreadyExistsException'
            ? 'Template already exists'
            : error?.message || 'Failed to create template';

        failedList.push({
          templateName: input.templateName,
          message,
          code,
        });
      }
    }

    return { successList, failedList };
  }
}
