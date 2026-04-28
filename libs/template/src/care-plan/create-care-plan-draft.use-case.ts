import type { ExecuteTemplateUseCase } from '../application/use-cases/execute-template.use-case';
import type { CreateCarePlanDraftInput } from './care-plan-draft.types';
import { mapExecuteResultToCarePlanDraft } from './map-execute-to-care-plan-draft';

export class CreateCarePlanDraftUseCase {
  constructor(private readonly executeTemplate: ExecuteTemplateUseCase) {}

  async execute(input: CreateCarePlanDraftInput) {
    const context: Record<string, unknown> = {
      ...input.context,
      patientId: input.patientId,
      effectiveDate: input.effectiveDate,
    };

    const execResult = await this.executeTemplate.execute({
      orgId: input.orgId,
      templateId: input.templateId,
      body: {
        version: input.version,
        context,
      },
    });

    return mapExecuteResultToCarePlanDraft(execResult, {
      patientId: input.patientId,
      effectiveDate: input.effectiveDate,
    });
  }
}
