import { templates } from './template.registry';
import { TemplateKey, TemplateData } from '../types/template.types';
import { renderString } from './template.renderer';

export function renderTemplate(
  templateKey: TemplateKey,
  data: TemplateData = {}
) {
  const tpl = templates[templateKey];

  if (!tpl) {
    return {
      subject: '',
      body: '',
      sms: '',
    };
  }

  return {
    subject: renderString(tpl.subject ?? '', data),
    body: renderString(tpl.body ?? '', data),
    sms: renderString(tpl.sms ?? '', data),
  };
}