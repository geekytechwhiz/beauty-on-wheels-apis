export type TemplateKey =
  | 'WELCOME_USER'
  | 'WELCOME_STAFF'
  | 'INVITE_USER'
  | 'PROFILE_UPDATED'
  | 'GENERIC_NOTIFICATION';

const templates: Record<TemplateKey, { subject?: string; body?: string; sms?: string }> = {
  WELCOME_USER: {
    subject: 'Welcome to {{ORG_NAME}}',
    body:
      "Hello,<br><br>Welcome to {{ORG_NAME}}. Your account has been created. Thank you for MyVitalRx.<br><br>This email message was sent from a notification-only address that cannot accept incoming email. Do not reply to this message.",
    sms: 'Welcome to {{ORG_NAME}}. Your account has been created. Thank you for MyVitalRx.',
  },
  WELCOME_STAFF: {
    subject: "Welcome to {{ORG_NAME}}'s Portal, {{STAFF_FIRST_NAME}}",
    body: `Dear {{STAFF_FIRST_NAME}},<br><br>We are pleased to welcome you to {{ORG_NAME}}'s web portal. To begin using the portal, please sign in by clicking the link below:<br><br><a href="{{PORTAL_LINK}}" style="color: blue; font-weight:bold" target="_blank">{{PORTAL_LINK}}</a><br><br>As part of the sign-in process, you will receive a One-Time Password (OTP) in a separate email. Please use that OTP to sign in.<br><br><b>First-Time Sign in Instructions:</b><ul><li>Click the link above to access the portal.</li><li>Enter your registered email address.</li><li>Check your inbox for the OTP email.</li><li>Enter the OTP when prompted to complete your sign in.</li></ul><br><br>The portal provides you with essential resources to streamline your work, save time and enhance efficiency. If you need any assistance or have any questions, please do not hesitate to contact us.<br><br>Best regards,<br><br>{{ORG_INFO}}`,
    sms: "Welcome to {{ORG_NAME}}'s Portal! To get started and access your account, please sign in using this link: {{PORTAL_LINK}}.",
  },
  INVITE_USER: {
    subject: 'You have been invited',
    body: '{{USER_FULLNAME}} has invited you to join {{ORG_NAME}}. Please sign up using this link: {{PORTAL_LINK}}',
    sms: 'You have been invited to join {{ORG_NAME}}. Use this link: {{PORTAL_LINK}}',
  },
  PROFILE_UPDATED: {
    subject: 'Your profile has been updated',
    body: 'Your profile has been updated successfully.',
    sms: 'Your profile has been updated successfully.',
  },
  GENERIC_NOTIFICATION: {
    subject: '{{TITLE}}',
    body: '{{BODY}}',
    sms: '{{BODY}}',
  },
};

function processIfBlocks(input: string, data: Record<string, unknown>): string {
  // Handles simple {{#if KEY}}...{{/if}} blocks
  return input.replace(/{{#if\s+([\w.]+)}}([\s\S]*?){{\/if}}/g, (_: string, key: string, inner: string) => {
    const val = data[String(key).trim()];
    if (val) {
      // recursively process inside
      return renderString(inner, data);
    }
    return '';
  });
}

function renderString(input: string, data: Record<string, unknown>): string {
  if (!input) return '';
  // process if blocks first
  let result: string = processIfBlocks(input, data);

  // simple placeholder replacement
  result = result.replace(/{{(.*?)}}/g, (_: string, key: string) => {
    const val = data[String(key).trim()];
    return typeof val === 'undefined' || val === null ? '' : String(val);
  });

  return result;
}

export function renderTemplate(templateKey: TemplateKey, data: Record<string, unknown> = {}) {
  const tpl = templates[templateKey];
  if (!tpl) return { subject: '', body: '', sms: '' };

  return { subject: renderString(tpl.subject || '', data), body: renderString(tpl.body || '', data), sms: renderString(tpl.sms || '', data) };
}
