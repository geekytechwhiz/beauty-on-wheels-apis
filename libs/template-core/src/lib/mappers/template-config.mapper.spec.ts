import { toTemplateConfigRecord } from './template-config.mapper';

describe('toTemplateConfigRecord', () => {
  it('hoists configType and templateType outside document', () => {
    const record = toTemplateConfigRecord('CARE-PLAN-MASTER-001', {
      id: 'CARE-PLAN-MASTER-001',
      configType: 'TEMPLATE',
      templateType: 'CARE_PLAN',
      titleKey: 'carePlan.title',
      fields: {},
    });

    expect(record).toEqual({
      configId: 'CARE-PLAN-MASTER-001',
      configType: 'TEMPLATE',
      templateType: 'CARE_PLAN',
      document: {
        id: 'CARE-PLAN-MASTER-001',
        titleKey: 'carePlan.title',
        fields: {},
      },
    });
  });

  it('hoists configType only for ORG configs', () => {
    const record = toTemplateConfigRecord('TEMPLATE_ENABLE', {
      id: 'TEMPLATE_ENABLE',
      configType: 'ORG',
      enableTemplateDrawer: { title: 'Enable' },
    });

    expect(record.configType).toBe('ORG');
    expect(record.templateType).toBeUndefined();
    expect(record.document.configType).toBeUndefined();
    expect(record.document.enableTemplateDrawer).toEqual({ title: 'Enable' });
  });
});
