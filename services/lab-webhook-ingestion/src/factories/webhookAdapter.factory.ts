import type { LabWebhookAdapter } from '../adapters/labWebhook.adapter';
import { createRedcliffeAdapter } from '../adapters/redcliffe.webhook';
import { createOrangeAdapter } from '../adapters/orange.webhook';
import { UnknownPartnerError } from '../utils/webhookErrors';

const REDCLIFFE = 'redcliffe';
const ORANGE = 'orange';

export function getWebhookAdapter(partnerId: string): LabWebhookAdapter {
  const normalised = partnerId.toLowerCase();
  switch (normalised) {
    case REDCLIFFE:
      return createRedcliffeAdapter(partnerId);
    case ORANGE:
      return createOrangeAdapter(partnerId);
    default:
      throw new UnknownPartnerError(partnerId);
  }
}
