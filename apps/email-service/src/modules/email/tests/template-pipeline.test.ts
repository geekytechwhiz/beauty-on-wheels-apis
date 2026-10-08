import {
  EmailValidationError,
  TemplateInactiveError,
  TemplateNotFoundError,
  TemplateParameterValidationError,
  TemplateRenderError,
} from '../domain/errors.js';
import { TEMPLATE_PARAMETER_TYPE } from '../domain/template-catalog.js';
import { TemplateParameterValidator } from '../templates/template-parameter-validator.js';
import { escapeHtml, TemplateRenderer } from '../templates/template-renderer.js';
import { TemplateResolver, type TemplateSource } from '../templates/template-resolver.js';

describe('template pipeline', () => {
  const source: TemplateSource = {
    getTemplate: jest.fn(async (name: string) => {
      if (name === 'appointment-confirmation') {
        return {
          templateName: name,
          subject: 'Appointment for {{patientName}}',
          htmlContent: '<p>Hello {{patientName}}</p><p>{{appointmentDate}} {{appointmentTime}}</p>',
          textContent: 'Hello {{patientName}} on {{appointmentDate}} at {{appointmentTime}}',
        };
      }
      if (name === 'appointment-confirmation__en-IN') {
        return {
          templateName: name,
          subject: 'Booking {{patientName}}',
          htmlContent: '<p>{{patientName}}</p>',
          textContent: '{{patientName}}',
        };
      }
      return null;
    }),
  };

  const resolver = new TemplateResolver(source, {
    'appointment-confirmation': {
      active: true,
      version: '1',
      locales: ['en-IN'],
      parameters: [
        { name: 'patientName', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'doctorName', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'appointmentDate', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        { name: 'appointmentTime', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
      ],
    },
    retired: {
      active: false,
      version: '1',
      parameters: [],
    },
  });

  it('rejects an unsupported locale, a missing template, and an inactive template', async () => {
    await expect(
      resolver.resolve({ templateName: 'appointment-confirmation', locale: 'fr-FR' }),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(resolver.resolve({ templateName: 'does-not-exist' })).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
    await expect(resolver.resolve({ templateName: 'retired' })).rejects.toBeInstanceOf(
      TemplateInactiveError,
    );
  });

  it('fails with the missing parameter names before rendering', () => {
    const validator = new TemplateParameterValidator();
    expect(() =>
      validator.validate({
        templateName: 'appointment-confirmation',
        subject: 'Appointment for {{patientName}}',
        htmlContent: '<p>{{appointmentDate}} {{appointmentTime}}</p>',
        declarations: [
          { name: 'patientName', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
          { name: 'appointmentDate', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
          { name: 'appointmentTime', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        ],
        parameters: { patientName: 'John' },
      }),
    ).toThrow(/appointmentDate[\s\S]*appointmentTime/);
    try {
      validator.validate({
        templateName: 'appointment-confirmation',
        subject: 'Hi',
        htmlContent: '<p>{{appointmentDate}}</p>',
        declarations: [
          { name: 'appointmentDate', required: true, type: TEMPLATE_PARAMETER_TYPE.STRING },
        ],
        parameters: { appointmentDate: '   ' },
      });
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateParameterValidationError);
    }
  });

  it('escapes HTML and renders subject and text deterministically', () => {
    const renderer = new TemplateRenderer();
    const first = renderer.render({
      templateName: 'appointment-confirmation',
      subject: 'Hello {{patientName}}',
      htmlContent: '<p>{{patientName}}</p>',
      textContent: 'Hello {{patientName}}',
      parameters: { patientName: '<script>alert(1)</script>' },
    });
    const second = renderer.render({
      templateName: 'appointment-confirmation',
      subject: 'Hello {{patientName}}',
      htmlContent: '<p>{{patientName}}</p>',
      textContent: 'Hello {{patientName}}',
      parameters: { patientName: '<script>alert(1)</script>' },
    });
    expect(first).toEqual(second);
    expect(first.htmlBody).toBe(`<p>${escapeHtml('<script>alert(1)</script>')}</p>`);
    expect(first.textBody).toContain('<script>');
    expect(first.subject).toBe('Hello <script>alert(1)</script>');
  });

  it('rejects template expressions that are not simple placeholders', () => {
    expect(() =>
      new TemplateRenderer().render({
        templateName: 'unsafe',
        subject: 'Hello',
        htmlContent: '<p>{{#if patientName}}x{{/if}}</p>',
        parameters: {},
      }),
    ).toThrow(TemplateRenderError);
  });

  it('resolves a localized template when one exists', async () => {
    const resolved = await resolver.resolve({
      templateName: 'appointment-confirmation',
      locale: 'en-IN',
    });
    expect(resolved.templateName).toBe('appointment-confirmation__en-IN');
    expect(resolved.subject).toContain('{{patientName}}');
  });
});
