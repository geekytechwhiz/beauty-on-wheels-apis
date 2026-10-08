import type { EmailTemplate } from '../../../common/providers/ITemplateRegistryProvider.js';
import type { ITemplateRegistryProvider } from '../../../common/providers/ITemplateRegistryProvider.js';
import {
  EmailValidationError,
  SesPermanentError,
  SesRetryableError,
  TemplateInactiveError,
  TemplateNotFoundError,
} from '../domain/errors.js';
import type {
  TemplateCatalog,
  TemplateCatalogEntry,
  TemplateParameterDeclaration,
} from '../domain/template-catalog.js';

export type StoredEmailTemplate = EmailTemplate;

export interface TemplateSource {
  getTemplate(templateName: string): Promise<StoredEmailTemplate | null>;
}

export type ResolveTemplateRequest = {
  templateName: string;
  locale?: string;
  templateVersion?: string;
};

export type ResolvedTemplate = {
  templateName: string;
  logicalName: string;
  subject: string;
  htmlContent?: string;
  textContent?: string;
  version: string;
  locale?: string;
  parameters: readonly TemplateParameterDeclaration[];
};

const LOCALIZED_NAME_SEPARATOR = '__';

export class SesTemplateSource implements TemplateSource {
  constructor(private readonly registry: ITemplateRegistryProvider) {}

  async getTemplate(templateName: string): Promise<StoredEmailTemplate | null> {
    try {
      return await this.registry.getTemplate(templateName);
    } catch (error) {
      if (isTemplateMissing(error)) {
        return null;
      }
      const name = errorName(error);
      if (isPermanentTemplateLookup(name)) {
        throw new SesPermanentError(`Unable to load template '${templateName}'`, {
          code: name,
          cause: error,
        });
      }
      throw new SesRetryableError(`Temporary failure loading template '${templateName}'`, {
        code: name,
        cause: error,
      });
    }
  }
}

export class TemplateResolver {
  constructor(
    private readonly source: TemplateSource,
    private readonly catalog: TemplateCatalog,
  ) {}

  async resolve(request: ResolveTemplateRequest): Promise<ResolvedTemplate> {
    const logicalName = request.templateName;
    const entry = this.catalog[logicalName];
    if (entry && !entry.active) {
      throw new TemplateInactiveError(logicalName);
    }
    if (request.locale && entry?.locales && !entry.locales.includes(request.locale)) {
      throw new EmailValidationError(
        `Unsupported locale '${request.locale}' for template '${logicalName}'`,
        { code: 'UNSUPPORTED_LOCALE' },
      );
    }
    if (request.templateVersion && entry?.version && request.templateVersion !== entry.version) {
      throw new EmailValidationError(
        `Template '${logicalName}' version '${request.templateVersion}' does not match '${entry.version}'`,
        { code: 'TEMPLATE_VERSION_MISMATCH' },
      );
    }

    const candidates = request.locale
      ? [`${logicalName}${LOCALIZED_NAME_SEPARATOR}${request.locale}`, logicalName]
      : [logicalName];

    let found: StoredEmailTemplate | null = null;
    let resolvedName = logicalName;
    for (const candidate of candidates) {
      const template = await this.source.getTemplate(candidate);
      if (template) {
        found = template;
        resolvedName = candidate;
        break;
      }
    }

    if (!found) {
      throw new TemplateNotFoundError(logicalName);
    }

    const subject = found.subject?.trim() ?? '';
    const htmlContent = found.htmlContent?.trim() || undefined;
    const textContent = found.textContent?.trim() || undefined;
    if (!subject) {
      throw new EmailValidationError(`Template '${logicalName}' is missing a subject`, {
        code: 'TEMPLATE_SUBJECT_MISSING',
      });
    }
    if (!htmlContent && !textContent) {
      throw new EmailValidationError(`Template '${logicalName}' is missing a body`, {
        code: 'TEMPLATE_BODY_MISSING',
      });
    }

    return {
      templateName: resolvedName,
      logicalName,
      subject,
      htmlContent,
      textContent,
      version: entry?.version ?? request.templateVersion ?? '1',
      locale: request.locale,
      parameters: entry?.parameters ?? [],
    };
  }
}

function isTemplateMissing(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotFoundException' || name === 'NotFound' || name === 'TemplateDoesNotExist';
}

function isPermanentTemplateLookup(name: string): boolean {
  return (
    name === 'AccessDeniedException' ||
    name === 'ValidationException' ||
    name === 'InvalidParameterException'
  );
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return 'UnknownError';
}

export function catalogEntry(
  catalog: TemplateCatalog,
  templateName: string,
): TemplateCatalogEntry | undefined {
  return catalog[templateName];
}
