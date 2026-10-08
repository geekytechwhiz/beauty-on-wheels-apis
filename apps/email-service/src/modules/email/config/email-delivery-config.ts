import { z } from 'zod';

import { environment, type EnvironmentConfig } from '../../../common/config/environment.js';
import { EmailConfigurationError } from '../domain/errors.js';

export type EmailDeliveryConfig = {
  fromEmail: string;
  fromName: string;
  replyTo: string[];
  configurationSetName?: string;
  unsubscribeUrl: string;
  lockTimeoutMs: number;
  tableName: string;
};

const emailSchema = z.string().email();

export function readEmailDeliveryConfig(
  env: EnvironmentConfig = environment,
): EmailDeliveryConfig {
  const fromEmail = env.defaultFromEmail.trim();
  if (!emailSchema.safeParse(fromEmail).success) {
    throw new EmailConfigurationError('DEFAULT_FROM_EMAIL is not a valid email address');
  }

  const replyTo = (env.sesReplyTo ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  for (const address of replyTo) {
    if (!emailSchema.safeParse(address).success) {
      throw new EmailConfigurationError('SES_REPLY_TO contains an invalid email address');
    }
  }

  return {
    fromEmail,
    fromName: env.defaultFromName.trim() || 'Beauty on Wheels',
    replyTo,
    configurationSetName: (env.sesConfigurationSet ?? '').trim() || undefined,
    unsubscribeUrl: env.sesUnsubscribeUrl ?? '',
    lockTimeoutMs:
      Number.isFinite(env.emailDeliveryLockMs) && env.emailDeliveryLockMs > 0
        ? env.emailDeliveryLockMs
        : 150_000,
    tableName: env.emailDeliveryTable ?? '',
  };
}
