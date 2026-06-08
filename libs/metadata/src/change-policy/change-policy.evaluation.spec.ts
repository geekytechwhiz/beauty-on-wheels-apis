import path from 'path';

import {
  evaluateChangeImpact,
  loadChangePolicyCatalogFromFile,
  parseChangePolicyCatalog,
  resetChangePolicyCatalogCache,
  VERSION_IMPACT,
  POLICY_GROUP,
  CHANGE_POLICY_OPERATION,
} from './index';

const SEED_PATH = path.join(__dirname, 'change-policy-rules.seed.json');

describe('change policy catalog', () => {
  afterEach(() => {
    resetChangePolicyCatalogCache();
  });

  it('loads and validates the seed catalog', () => {
    const catalog = loadChangePolicyCatalogFromFile(SEED_PATH);
    expect(catalog.version).toBe('1.0.0');
    expect(catalog.rules.length).toBeGreaterThanOrEqual(40);
    expect(catalog.rules.some((r) => r.objectPath === 'MetricCode.ValueAttributes.unit')).toBe(true);
  });

  it('rejects duplicate ruleId', () => {
    const catalog = loadChangePolicyCatalogFromFile(SEED_PATH);
    const broken = {
      ...catalog,
      rules: [...catalog.rules, { ...catalog.rules[0] }],
    };
    expect(() => parseChangePolicyCatalog(broken)).toThrow(/Duplicate ruleId/);
  });

  it('rejects invalid policy group', () => {
    expect(() =>
      parseChangePolicyCatalog({
        version: '1.0.0',
        rules: [
          {
            ruleId: 'BAD',
            objectPath: 'MetadataValue.Label',
            operation: 'Update',
            policyGroup: 'NOT_A_GROUP',
            versionImpact: 'Descriptive',
            requiresMetadataVersion: false,
            requiresTemplateAdoption: false,
            requiresOrgCapabilityReevaluation: false,
            runtimeImpact: 'None',
            canAutoApplyToPublishedCarePlan: false,
            canAutoApplyToActiveRuntime: false,
            mergeBehavior: 'SilentDisplayRefresh',
            uxDiffRequired: false,
          },
        ],
      }),
    ).toThrow(/Invalid change policy catalog/);
  });
});

describe('evaluateChangeImpact', () => {
  const catalog = loadChangePolicyCatalogFromFile(SEED_PATH);

  it('classifies label-only change as DISPLAY_ONLY without metadata version', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HYPERTENSION',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'HYPERTENSION',
          label: 'Hypertension',
          status: 'ACTIVE',
        },
        proposedPayload: { label: 'High Blood Pressure' },
      },
      catalog,
    );

    expect(impact.policyGroups).toContain(POLICY_GROUP.DISPLAY_ONLY);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.DESCRIPTIVE);
    expect(impact.requiresMetadataVersion).toBe(false);
    expect(impact.requiresTemplateAdoption).toBe(false);
    expect(impact.requiresOrgCapabilityReevaluation).toBe(false);
    expect(impact.uxDiffRequired).toBe(false);
    expect(impact.changedObjectPaths).toContain('MetadataValue.Label');
  });

  it('classifies metric unit change as STRUCTURED_BEHAVIOR with breaking flags', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'BP_SYSTOLIC',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: {
          metadataTypeCode: 'MetricCode',
          metadataValueCode: 'BP_SYSTOLIC',
          label: 'BP Systolic',
          status: 'ACTIVE',
          valueAttributes: { unit: 'mmHg', dataType: 'Numeric' },
        },
        proposedPayload: { valueAttributes: { unit: 'kPa' } },
      },
      catalog,
    );

    expect(impact.policyGroups).toContain(POLICY_GROUP.STRUCTURED_BEHAVIOR);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.BREAKING);
    expect(impact.requiresMetadataVersion).toBe(true);
    expect(impact.requiresTemplateAdoption).toBe(true);
    expect(impact.requiresOrgCapabilityReevaluation).toBe(true);
    expect(impact.uxDiffRequired).toBe(true);
    expect(impact.changedObjectPaths).toContain('MetricCode.ValueAttributes.unit');
  });

  it('classifies new value Add as additive with org capability re-evaluation', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'DIABETES',
        workflowOperation: CHANGE_POLICY_OPERATION.ADD,
        basePayload: null,
        proposedPayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'DIABETES',
          label: 'Diabetes',
          status: 'ACTIVE',
          applicableConditions: ['DIABETES'],
        },
      },
      catalog,
    );

    expect(impact.policyGroups).toContain(POLICY_GROUP.APPLICABILITY_SCOPE);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.ADDITIVE);
    expect(impact.requiresMetadataVersion).toBe(false);
    expect(impact.requiresOrgCapabilityReevaluation).toBe(true);
    expect(impact.changedObjectPaths).toEqual(['MetadataValue']);
    expect(impact.changedObjectPaths).not.toContain('MetadataValue.Label');
    expect(impact.changedObjectPaths).not.toContain('MetadataValue.ApplicableConditions');
  });

  it('classifies inactivate as AVAILABILITY_STATUS', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'DIABETES',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'DIABETES',
          label: 'Diabetes',
          status: 'ACTIVE',
        },
        proposedPayload: { status: 'INACTIVE' },
      },
      catalog,
    );

    expect(impact.policyGroups).toContain(POLICY_GROUP.AVAILABILITY_STATUS);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.BREAKING);
    expect(impact.requiresOrgCapabilityReevaluation).toBe(true);
    expect(impact.mergeBehavior).toBe('Block');
    const statusChange = impact.changes.find((c) => c.objectPath === 'MetadataValue.Status');
    expect(statusChange?.operation).toBe(CHANGE_POLICY_OPERATION.INACTIVATE);
  });

  it('classifies applicability expand differently from restrict', () => {
    const expand = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HTN',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'HTN',
          label: 'Hypertension',
          status: 'ACTIVE',
          applicableConditions: ['HTN'],
        },
        proposedPayload: { applicableConditions: ['HTN', 'DIABETES'] },
      },
      catalog,
    );

    expect(expand.versionImpact).toBe(VERSION_IMPACT.ADDITIVE);
    expect(expand.requiresMetadataVersion).toBe(false);
    expect(expand.requiresOrgCapabilityReevaluation).toBe(true);

    const restrict = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HTN',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'HTN',
          label: 'Hypertension',
          status: 'ACTIVE',
          applicableConditions: ['HTN', 'DIABETES'],
        },
        proposedPayload: { applicableConditions: ['HTN'] },
      },
      catalog,
    );

    expect(restrict.versionImpact).toBe(VERSION_IMPACT.BREAKING);
    expect(restrict.requiresMetadataVersion).toBe(true);
    expect(restrict.requiresOrgCapabilityReevaluation).toBe(true);
    expect(restrict.changes.find((c) => c.objectPath === 'MetadataValue.ApplicableConditions')?.changeKind).toBe(
      'Restrict',
    );
    expect(expand.changes.find((c) => c.objectPath === 'MetadataValue.ApplicableConditions')?.changeKind).toBe(
      'Expand',
    );
  });

  it('does not expose ruleId in aggregated impact', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'BP_SYSTOLIC',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: {
          metadataTypeCode: 'MetricCode',
          metadataValueCode: 'BP_SYSTOLIC',
          label: 'BP',
          status: 'ACTIVE',
          valueAttributes: { unit: 'mmHg' },
        },
        proposedPayload: { valueAttributes: { unit: 'kPa' } },
      },
      catalog,
    );

    expect(JSON.stringify(impact)).not.toMatch(/ruleId|RULE-/);
  });
});
