import { TemplateRenderError } from '../domain/errors.js';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const UNSAFE_PLACEHOLDER = /\{\{(?!\s*(?:amazonSESUnsubscribeUrl|[A-Za-z_][A-Za-z0-9_]*)\s*\}\})/;
const SES_UNSUBSCRIBE = /\{\{\s*amazonSESUnsubscribeUrl\s*\}\}/g;

export function collectPlaceholders(...parts: Array<string | undefined>): string[] {
  const names = new Set<string>();
  for (const part of parts) {
    if (!part) {
      continue;
    }
    assertSafeTemplate(part);
    for (const match of part.matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (name && name !== 'amazonSESUnsubscribeUrl') {
        names.add(name);
      }
    }
  }
  return [...names];
}

export type RenderedEmail = {
  subject: string;
  htmlBody?: string;
  textBody?: string;
};

export class TemplateRenderer {
  render(input: {
    templateName: string;
    subject: string;
    htmlContent?: string;
    textContent?: string;
    parameters: Record<string, unknown>;
    optionalParameters?: ReadonlySet<string>;
    unsubscribeUrl?: string;
  }): RenderedEmail {
    assertSafeTemplate(input.subject);
    if (input.htmlContent) {
      assertSafeTemplate(input.htmlContent);
    }
    if (input.textContent) {
      assertSafeTemplate(input.textContent);
    }

    const optional = input.optionalParameters ?? new Set<string>();
    const subject = stripHeaderBreaks(
      substitute(input.subject, input.parameters, optional, false),
    );
    const htmlBody = input.htmlContent
      ? substitute(input.htmlContent, input.parameters, optional, true).replace(
          SES_UNSUBSCRIBE,
          input.unsubscribeUrl ?? '',
        )
      : undefined;
    const textBody = input.textContent
      ? substitute(input.textContent, input.parameters, optional, false).replace(
          SES_UNSUBSCRIBE,
          input.unsubscribeUrl ?? '',
        )
      : undefined;

    if (!subject.trim()) {
      throw new TemplateRenderError(`Template '${input.templateName}' rendered an empty subject`);
    }

    return {
      subject,
      htmlBody,
      textBody,
    };
  }
}

function assertSafeTemplate(template: string): void {
  if (UNSAFE_PLACEHOLDER.test(template)) {
    throw new TemplateRenderError('Template contains an unsupported placeholder expression');
  }
}

function substitute(
  template: string,
  parameters: Record<string, unknown>,
  optional: ReadonlySet<string>,
  escapeHtmlValues: boolean,
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    if (name === 'amazonSESUnsubscribeUrl') {
      return _match;
    }
    const value = parameters[name];
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (optional.has(name)) {
        return '';
      }
      throw new TemplateRenderError(`Missing value for template parameter '${name}'`);
    }
    const rendered = stringifyParameter(value);
    return escapeHtmlValues ? escapeHtml(rendered) : rendered;
  });
}

function stringifyParameter(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new TemplateRenderError('Template parameters must be strings, numbers, or booleans');
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}
