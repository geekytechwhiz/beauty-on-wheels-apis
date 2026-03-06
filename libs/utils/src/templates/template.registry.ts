import { NotificationTemplate, TemplateKey } from '../types/template.types';

export const templates: Record<TemplateKey, NotificationTemplate> = {
  WELCOME_USER: {
    subject: 'Welcome to {{ORG_NAME}}, {{USER_FIRST_NAME}}!',
    body: `Dear {{USER_FIRST_NAME}},<br><br>
We welcome you to {{ORG_NAME}}, where your health and well-being are our top priorities.
<br><br>
<a href="{{WEB_DNS_URL}}?referrer={{HOSPITAL_ID}}&referrer_name={{ORG_NAME}}&referrer_address={{ORG_ADDRESS}}&source={{TYPE}}{{DEVICE}}" target="_blank" style="color: blue; font-weight:bold">
Download here
</a>
<br><br>
Warm regards,<br>{{ORG_INFO}}`,
    sms: 'Welcome to {{ORG_NAME}}! To get started, please sign in using this link:',
  },

  WELCOME_STAFF: {
    subject: "Welcome to {{ORG_NAME}}'s Portal, {{STAFF_FIRST_NAME}}",
    body: `Dear {{STAFF_FIRST_NAME}},<br><br>
We are pleased to welcome you to {{ORG_NAME}}'s web portal.
<br><br>
<a href="{{PORTAL_LINK}}" target="_blank">{{PORTAL_LINK}}</a>
<br><br>
{{ORG_INFO}}`,
    sms: "Welcome to {{ORG_NAME}}'s Portal! Sign in here: {{PORTAL_LINK}}",
  },

  INVITE_USER: {
    subject: 'You have been invited',
    body: '{{USER_FULLNAME}} has invited you to join {{ORG_NAME}}. Use this link: {{PORTAL_LINK}}',
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