import { normalizeTemplateStatus } from '../../domain/template-status';
import type { RuntimeTemplateBinding } from '../../domain';
import { TemplateNotPublishedError, TemplateRuntimeBindingConflictError } from '../../shared';
import type { RuntimeBindingRepository } from '../runtime-binding.repository.port';
import type { TemplateRepository } from '../template-repository.port';

export interface BindRuntimeTemplateInput {
  patientId: string;
  templateId: string;
  version: string;
  orgId: string;
}

export class BindRuntimeTemplateUseCase {
  constructor(
    private readonly runtimeBindingRepository: RuntimeBindingRepository,
    private readonly templateRepository: TemplateRepository,
  ) {}

  async execute(input: BindRuntimeTemplateInput): Promise<RuntimeTemplateBinding> {
    const published = await this.templateRepository.getPublishedVersion(input.orgId, input.templateId);
    if (!published || normalizeTemplateStatus(published.status) !== 'PUBLISHED') {
      throw new TemplateNotPublishedError(
        `No published template '${input.templateId}' for org '${input.orgId}'`,
      );
    }
    if (published.version !== input.version) {
      throw new TemplateNotPublishedError(
        `Runtime binding must use the published version (${published.version}), not '${input.version}'`,
      );
    }

    const existing = await this.runtimeBindingRepository.getRuntimeBinding(input.patientId, input.templateId);
    if (existing) {
      if (existing.version !== input.version || existing.orgId !== input.orgId) {
        throw new TemplateRuntimeBindingConflictError(
          `Template ${input.templateId} is already bound to version ${existing.version}`,
        );
      }
      return existing;
    }

    return this.runtimeBindingRepository.bindRuntimeVersion({
      patientId: input.patientId,
      templateId: input.templateId,
      version: input.version,
      orgId: input.orgId,
      createdAt: new Date().toISOString(),
    });
  }
}
