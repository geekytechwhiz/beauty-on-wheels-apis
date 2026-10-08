import { TemplateParameterValidationError } from '../domain/errors.js';
import {
  TEMPLATE_PARAMETER_TYPE,
  type TemplateParameterDeclaration,
  type TemplateParameterType,
} from '../domain/template-catalog.js';
import { collectPlaceholders } from './template-renderer.js';

export class TemplateParameterValidator {
  validate(input: {
    templateName: string;
    subject: string;
    htmlContent?: string;
    textContent?: string;
    declarations: readonly TemplateParameterDeclaration[];
    parameters: Record<string, unknown>;
  }): void {
    const placeholders = collectPlaceholders(
      input.subject,
      input.htmlContent,
      input.textContent,
    );
    const declared = new Map(input.declarations.map((item) => [item.name, item]));
    const required: TemplateParameterDeclaration[] = [...input.declarations];

    for (const placeholder of placeholders) {
      if (!declared.has(placeholder)) {
        required.push({
          name: placeholder,
          required: true,
          type: TEMPLATE_PARAMETER_TYPE.STRING,
        });
      }
    }

    const missing: string[] = [];
    const invalid: string[] = [];

    for (const declaration of required) {
      const value = input.parameters[declaration.name];
      if (!declaration.required && isEmpty(value)) {
        continue;
      }
      if (isEmpty(value)) {
        missing.push(declaration.name);
        continue;
      }
      if (!matchesType(value, declaration.type, declared.has(declaration.name))) {
        invalid.push(`${declaration.name} expected ${declaration.type}`);
      }
    }

    if (missing.length === 0 && invalid.length === 0) {
      return;
    }

    const lines = [`Template: ${input.templateName}`];
    if (missing.length > 0) {
      lines.push('Missing parameters:', ...missing.map((name) => `- ${name}`));
    }
    if (invalid.length > 0) {
      lines.push('Invalid parameters:', ...invalid.map((name) => `- ${name}`));
    }
    throw new TemplateParameterValidationError(lines.join('\n'));
  }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  return false;
}

function matchesType(
  value: unknown,
  type: TemplateParameterType,
  declared: boolean,
): boolean {
  if (!declared && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
    return type === TEMPLATE_PARAMETER_TYPE.STRING;
  }
  if (type === TEMPLATE_PARAMETER_TYPE.STRING) {
    return typeof value === 'string';
  }
  if (type === TEMPLATE_PARAMETER_TYPE.NUMBER) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return typeof value === 'boolean';
}
