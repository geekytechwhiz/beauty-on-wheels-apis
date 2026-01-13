import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import axios from 'axios';
import { createLogger, serializeError } from '@api-hub/logger';
import { renderTemplate } from '@api-hub/utils';

const logger = createLogger({ service: 'notification-delivery', redactPII: true });

let cachedSecrets: Record<string, any> | null = null;

async function getSecrets(): Promise<Record<string, any>> {
  if (cachedSecrets) return cachedSecrets;
  const secretName = process.env.SECRET_MANAGER_NAME;
  const region = process.env.DEFAULT_REGION || process.env.DP_REGION || 'us-east-1';
  if (!secretName) throw new Error('Secret manager name not set (NOTIFICATION_SECRET_NAME or SECRET_MANAGER_NAME)');

  const client = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);
  if ('SecretString' in response && response.SecretString) {
    cachedSecrets = JSON.parse(response.SecretString) as Record<string, any>;
    return cachedSecrets;
  }
  throw new Error('Secret not found or invalid');
}

export async function sendEmail(options: { email?: string; template?: string; templateData?: Record<string, unknown> }) {
  try {
    if (!options.email) throw new Error('Email not provided');
    const secrets = await getSecrets();
    const data = buildEmailPayload(options.email, options.template, options.templateData || {});

    const apiData = {
      method: 'POST',
      url: secrets.EMAIL_API_URL,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: secrets.AUTHORIZATION_KEY,
      },
      data,
    };

    await axios(apiData);
    logger.info({ event: 'send_email_success', email: options.email });
    return { success: true };
  } catch (err) {
    logger.error({ event: 'send_email_error', err: serializeError(err) });
    throw err;
  }
}

function buildEmailPayload(email: string, template?: string, templateData: Record<string, unknown> = {}) {
  // Use registry renderer when template key is provided and matches our registry
  let subject = template ? `${template} Notification` : 'Notification from MyVitalRx';
  let html = `<p>${Object.entries(templateData).map(([k, v]) => `${k}: ${v}`).join('<br>')}</p>`;

  try {
    if (template && (template === 'WELCOME' || template === 'WELCOME_USER' || template === 'WELCOME_STAFF' || template === 'INVITE' || template === 'PROFILE_UPDATED' || template === 'GENERIC_NOTIFICATION')) {
      // map common names to registry keys
      const map: Record<string, any> = {
        WELCOME: 'WELCOME_USER',
        WELCOME_USER: 'WELCOME_USER',
        WELCOME_STAFF: 'WELCOME_STAFF',
        INVITE: 'INVITE_USER',
        PROFILE_UPDATED: 'PROFILE_UPDATED',
        GENERIC_NOTIFICATION: 'GENERIC_NOTIFICATION',
      };
      const key = map[template as string] || map.WELCOME_USER;
      const rendered = renderTemplate(key, templateData);
      subject = rendered.subject || subject;
      html = rendered.body || html;
    }
  } catch (err) {
    // fall back to minimal rendering
  }

  return {
    emailId: email,
    templateContent: {
      subject,
      html,
    },
    customAttributes: {
      ...Object.fromEntries(Object.entries(templateData).map(([k, v]) => [k.toUpperCase(), [String(v)]])),
      CURRENT_YEAR: [new Date().getFullYear()],
    },
  };
}

function resolvePhoneNumber(req: { phone?: string }) {
  if (!req.phone) throw new Error('Phone number missing');
  return req.phone;
}

function normalizeIndianPhone(input: string) {
  let value = String(input).trim();
  value = value.replace(/(?!^\+)\D/g, '');

  if (value.startsWith('+91')) {
    value = value.slice(3);
  }

  value = value.replace(/^0+/, '');

  if (!/^\d{10}$/.test(value)) {
    throw new Error('Invalid Indian mobile number');
  }

  return `+91${value}`;
}

export async function sendSms(options: { phone?: string; template?: string; templateData?: Record<string, unknown> }) {
  try {
    const phone = resolvePhoneNumber({ phone: options.phone });
    const formattedPhone = normalizeIndianPhone(phone);

    let message = '';
    try {
      if (options.template) {
        const map: Record<string, any> = { WELCOME: 'WELCOME_USER', WELCOME_USER: 'WELCOME_USER', WELCOME_STAFF: 'WELCOME_STAFF', INVITE: 'INVITE_USER', PROFILE_UPDATED: 'PROFILE_UPDATED' };
        const key = (map[options.template as string] || options.template) as any;
        const rendered = renderTemplate(key, options.templateData || {});
        message = rendered.sms || rendered.body || `${options.template}`;
      } else if (options.templateData && Object.keys(options.templateData).length > 0) {
        message = Object.entries(options.templateData).map(([k, v]) => `${k}=${v}`).join(', ');
      } else {
        message = 'You have a new notification from MyVitalRx';
      }
    } catch (err) {
      message = options.template || 'You have a new notification from MyVitalRx';
    }

    const payload = {
      dltContentId: process.env.DLT_CONTENT_ID || '',
      phoneNumber: formattedPhone,
      message,
    };

    await axios({ method: 'POST', url: process.env.SMS_API_URL, timeout: 5000, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, data: payload });
    logger.info({ event: 'send_sms_success', phone: formattedPhone });
    return { success: true };
  } catch (err) {
    logger.error({ event: 'send_sms_error', err: serializeError(err) });
    throw err;
  }
}

export async function sendPush(options: { deviceToken?: string; template?: string; templateData?: Record<string, unknown> }) {
  logger.info({ event: 'send_push_placeholder', note: 'Push notifications not implemented yet' });
  // Placeholder for integrating FCM / APNS etc.
  return { success: false, reason: 'not_implemented' };
}
