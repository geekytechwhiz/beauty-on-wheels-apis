import {
  TemplateEntityBuilder,
  type CreateMasterTemplateInput,
} from '../builder/template-entity.builder';
import { toMasterListItem, toTemplateSummary } from '../mappers/template-http.dto';
import type { ListMasterTemplatesParams, ListMasterTemplatesResult } from '../models/api/list-master.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import {
  listMasterNextToken,
  TemplateRepository,
} from '../repositories/template.repository';
import { normalizeTemplateServiceError } from '../errors/template-errors';

export class TemplateService {
  constructor(private readonly repo = new TemplateRepository()) {}

  async createMasterTemplate(
    input: CreateMasterTemplateInput,
    actorUserId?: string,
  ): Promise<{ record: TemplateDdbRecord }> {
    try {
      const templateId = TemplateEntityBuilder.normalizeTemplateId(input.templateCode);
      const existing = await this.repo.getMasterMeta(templateId);
      if (existing) {
        const conflict = new Error('Master template already exists') as Error & {
          statusCode: number;
          code: string;
        };
        conflict.statusCode = 409;
        conflict.code = 'CONFLICT';
        throw conflict;
      }

      const record = await this.repo.createMasterTemplate({
        ...input,
        createdBy: input.createdBy ?? actorUserId,
      });
      return { record };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  async listMasterTemplates(params: ListMasterTemplatesParams): Promise<ListMasterTemplatesResult> {
    try {
      const { items, lastEvaluatedKey } = await this.repo.listMasterTemplates(params);
      return {
        items: items.map(toMasterListItem),
        nextToken: listMasterNextToken(lastEvaluatedKey),
      };
    } catch (e: unknown) {
      normalizeTemplateServiceError(e);
    }
  }

  toCreateResponse(record: TemplateDdbRecord) {
    return toTemplateSummary(record);
  }
}
