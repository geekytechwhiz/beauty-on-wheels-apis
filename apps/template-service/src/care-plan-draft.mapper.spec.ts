import type { TemplateExecutionResult } from '@api-hub/template';
import { mapExecuteResultToCarePlanDraft } from '@api-hub/care-plan';

describe('mapExecuteResultToCarePlanDraft', () => {
  it('maps execution + patient binding to draft', () => {
    const exec: TemplateExecutionResult = {
      matched: true,
      actions: [],
      resolved: {
        templateId: 't1',
        orgId: 'org-1',
        version: 'v1',
        config: { foo: 'bar' },
        rules: [],
        actions: [],
        resolutionChain: [{ templateId: 'base', version: 'v1' }],
      },
      ruleEvaluation: {
        matched: true,
        appliedRuleIds: ['R1'],
        actions: [
          {
            type: 'TRIGGER_EVENT',
            target: 'LINK_REQUIRED',
            value: { requiredTemplate: 'OKR' },
          },
          { type: 'SET', target: 'validation.x', value: 'VALID' },
        ],
        trace: [],
      },
    };

    const draft = mapExecuteResultToCarePlanDraft(exec, {
      patientId: 'pat-1',
      effectiveDate: '2026-04-02',
    });

    expect(draft.policy.linkRequirements).toEqual([{ requiredTemplate: 'OKR' }]);
    expect(draft.policy.validationHints['validation.x']).toBe('VALID');
    expect(draft.carePlanStatus).toBe('ready_for_linking');
  });
});
