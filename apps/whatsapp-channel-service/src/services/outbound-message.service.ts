import { ChannelError, CHANNEL_ERROR_CODE } from '../errors/channel-error';
import { ConversationStore } from '../repositories/conversation.repository';
import { MetaWhatsAppProvider } from '../providers/meta-whatsapp.provider';
import { missingTemplateVariables, TEMPLATE_REGISTRY, TemplateKey } from '../templates/registry';

export class OutboundMessageService {
  constructor(
    private readonly meta: MetaWhatsAppProvider,
    private readonly store: ConversationStore,
  ) {}

  async sendTemplate(to: string, key: TemplateKey, variables: Record<string, string>): Promise<void> {
    const definition = TEMPLATE_REGISTRY[key];
    const missing = missingTemplateVariables(definition, variables);
    if (missing.length > 0) {
      throw new ChannelError(CHANNEL_ERROR_CODE.VALIDATION_ERROR, `Missing template variables: ${missing.join(', ')}`, {
        metadata: { templateKey: key, missing },
      });
    }
    if (definition.marketing) {
      const optedIn = await this.store.getMarketingConsent(to);
      if (!optedIn) {
        throw new ChannelError(CHANNEL_ERROR_CODE.AUTHORIZATION_ERROR, 'Marketing consent is required', {
          metadata: { templateKey: key },
        });
      }
    }
    const parameters = definition.requiredVariables.map((name) => ({ type: 'text' as const, text: variables[name] }));
    await this.meta.template(to, definition.metaName, definition.language, parameters);
  }
}
