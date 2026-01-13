export type TemplateKey =
  | 'WELCOME_USER'
  | 'WELCOME_STAFF'
  | 'INVITE_USER'
  | 'PROFILE_UPDATED'
  | 'GENERIC_NOTIFICATION';

const templates: Record<TemplateKey, { subject?: string; body?: string; sms?: string }> = {
  WELCOME_USER: {
    subject: 'Welcome to {{ORG_NAME}}, {{USER_FIRST_NAME}}!',
    body: `Dear {{USER_FIRST_NAME}},<br><br>We welcome you to {{ORG_NAME}}, where your health and well-being are our top priorities. To get started and access our services, please sign in by clicking the link below:<br><br><a href="{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}" target="_blank" style="color: blue; font-weight:bold">Download here</a><br><br>Our entire medical team is committed to providing you with personalized and compassionate care. If you have any questions or need assistance, please do not hesitate to contact us.<br><br>We look forward to being your trusted partner in health.<br><br>Warm regards,<br><br>{{ORG_INFO}}`,
    sms: 'Welcome to {{ORG_NAME}}! To get started and access our services, please sign in using this link: {{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}',
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
  return input.replace(/{{#if\s+([\w.]+)}}([\s\S]*?){{\/if}}/g, (_: string, key: string, inner: string) => {
    const val = data[String(key).trim()];
    if (val) {
      return renderString(inner, data);
    }
    return '';
  });
}

function renderString(input: string, data: Record<string, unknown>): string {
  if (!input) return '';
  let result: string = processIfBlocks(input, data);

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
