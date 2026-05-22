import { firstString } from '../utils/template.utils';
import type {
  CompatibleTemplateItem,
  ListCompatibleTemplatesParams,
} from '../models/api/compatible-templates.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import { TEMPLATE_STATUS, TEMPLATE_TYPE_CARE_PLAN } from '../constants/template.constants';
import { TemplateRepository } from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';
import { templateValidationError } from '../utils/template.utils';

function extractDuration(record: TemplateDdbRecord): string | undefined {
  const attrs = record.carePlanAttributes as Record<string, unknown> | undefined;
  const dur = attrs?.duration as Record<string, unknown> | undefined;
  const fromAttrs = dur?.durationType as string | undefined;
  if (fromAttrs) return fromAttrs;
  return record.meta?.duration as string | undefined;
}

function normalizeDurationCode(value: string): string {
  const v = value.trim().toUpperCase();
  const map: Record<string, string> = {
    '90D': 'DAYS_90',
    DAYS_90: 'DAYS_90',
    '30D': 'DAYS_30',
    DAYS_30: 'DAYS_30',
    '6M': 'MONTHS_6',
    MONTHS_6: 'MONTHS_6',
    YEAR_1: 'YEAR_1',
  };
  return map[v] ?? v;
}

function matchesCountry(meta: TemplateDdbRecord['meta'], country: string): boolean {
  const countries = meta.countries;
  if (!countries?.length) return true;
  return countries.includes(country) || countries.includes('ALL');
}

function matchesCondition(meta: TemplateDdbRecord['meta'], condition: string): boolean {
  const c = condition.trim();
  if (meta.condition === c) return true;
  if (Array.isArray(meta.conditions) && meta.conditions.includes(c)) return true;
  return false;
}

export class CompatibleTemplatesService {
  constructor(private readonly repo = new TemplateRepository()) {}

  async listCompatibleTemplates(
    params: ListCompatibleTemplatesParams,
  ): Promise<{ items: CompatibleTemplateItem[] }> {
    try {
      if (!params.condition?.trim() || !params.country?.trim()) {
        templateValidationError('condition and country query parameters are required');
      }

      const templateType = params.templateType?.trim() || TEMPLATE_TYPE_CARE_PLAN;
      const limit = Math.min(100, Math.max(1, params.limit ?? 50));
      const wantDuration = params.duration?.trim()
        ? normalizeDurationCode(params.duration)
        : undefined;

      // Query GSI2 without FilterExpression — meta.condition may be string or list and
      // `contains()` on countries/conditions causes DynamoDB ValidationException when types differ.
      const { items } = await this.repo.queryMasterCatalogGsi2Page(templateType, {
        limit,
      });

      const seen = new Map<string, CompatibleTemplateItem>();

      for (const record of items) {
        if (record.meta?.status !== TEMPLATE_STATUS.PUBLISHED) continue;
        if (!matchesCondition(record.meta, params.condition)) continue;
        if (!matchesCountry(record.meta, params.country)) continue;

        const recordDur = extractDuration(record);
        if (wantDuration && recordDur) {
          if (normalizeDurationCode(recordDur) !== wantDuration) continue;
        }

        const templateId = record.meta.templateId;
        if (!templateId || seen.has(templateId)) continue;

        seen.set(templateId, {
          templateId,
          templateVersionId: record.meta.templateVersionId,
          templateName: record.meta.templateName,
          condition: firstString(record.meta.condition ?? record.meta.conditions),
          countries: record.meta.countries,
          duration: recordDur,
          status: record.meta.status ?? TEMPLATE_STATUS.PUBLISHED,
          publishedAt: record.meta.publishedAt ?? null,
        });
      }

      return { items: [...seen.values()] };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }
}
