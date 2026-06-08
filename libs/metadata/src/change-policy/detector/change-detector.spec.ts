import path from 'path';

import {
  evaluateChangeImpact,
  loadChangePolicyCatalogFromFile,
  CHANGE_POLICY_OPERATION,
  POLICY_GROUP,
  VERSION_IMPACT,
} from '../index';
import { detectFieldChanges } from './change-detector';

const SEED_PATH = path.join(__dirname, '..', 'change-policy-rules.seed.json');
const catalog = loadChangePolicyCatalogFromFile(SEED_PATH);

function objectPaths(input: Parameters<typeof detectFieldChanges>[0]): string[] {
  return detectFieldChanges(input).map((c) => c.objectPath);
}

function findChange(input: Parameters<typeof detectFieldChanges>[0], objectPath: string) {
  return detectFieldChanges(input).find((c) => c.objectPath === objectPath);
}

const publishedValueBase = {
  metadataTypeCode: 'CourierChannel',
  metadataValueCode: 'HELICOPTER',
  label: 'Helicopter',
  status: 'ACTIVE',
  isGlobal: false,
  valueAttributes: {},
  applicableModules: ['TASK'],
  applicableCategories: [],
  applicableConditions: [],
  applicableCountries: [],
  applicableLanguages: [],
};

describe('detectFieldChanges Add', () => {
  it('simple MetadataType Add emits only MetadataType', () => {
    const paths = objectPaths({
      entityType: 'type',
      metadataTypeCode: 'CourierChannel',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'CourierChannel',
        displayName: 'Courier Channel',
        description: 'Channels',
        valueDataType: 'Enum',
        multiSelectAllowed: false,
        applicableModules: ['TASK'],
        status: 'ACTIVE',
      },
    });

    expect(paths).toEqual(['MetadataType']);
  });

  it('simple MetadataValue Add emits only MetadataValue', () => {
    const paths = objectPaths({
      entityType: 'value',
      metadataTypeCode: 'Condition',
      metadataValueCode: 'DIABETES',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'Condition',
        metadataValueCode: 'DIABETES',
        label: 'Diabetes',
        description: 'Type 2',
        sortOrder: 1,
        status: 'ACTIVE',
        applicableModules: ['CLINICAL'],
        applicableConditions: ['DIABETES'],
      },
    });

    expect(paths).toEqual(['MetadataValue']);
  });

  it('does not emit MetadataValue.Label on simple Add', () => {
    const paths = objectPaths({
      entityType: 'value',
      metadataTypeCode: 'Condition',
      metadataValueCode: 'HTN',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HTN',
        label: 'Hypertension',
        status: 'ACTIVE',
      },
    });

    expect(paths).not.toContain('MetadataValue.Label');
    expect(paths).not.toContain('MetadataValue.Description');
    expect(paths).not.toContain('MetadataValue.ApplicableModules');
  });

  it('MetadataType Add with AttributeSchema emits parent and schema path', () => {
    const paths = objectPaths({
      entityType: 'type',
      metadataTypeCode: 'MetricCode',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'MetricCode',
        displayName: 'Metric',
        valueDataType: 'Numeric',
        multiSelectAllowed: false,
        status: 'ACTIVE',
        attributeSchema: { unit: { type: 'string' }, dataType: { type: 'string' } },
      },
    });

    expect(paths).toContain('MetadataType');
    expect(paths).toContain('MetadataType.AttributeSchema');
    expect(paths).toHaveLength(2);
  });

  it('MetricCode Add with structured attributes emits parent and metric attribute paths', () => {
    const paths = objectPaths({
      entityType: 'value',
      metadataTypeCode: 'MetricCode',
      metadataValueCode: 'BP_SYSTOLIC',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'MetricCode',
        metadataValueCode: 'BP_SYSTOLIC',
        label: 'BP Systolic',
        status: 'ACTIVE',
        valueAttributes: { unit: 'mmHg', dataType: 'Numeric' },
      },
    });

    expect(paths).toContain('MetadataValue');
    expect(paths).toContain('MetricCode.ValueAttributes');
    expect(paths).toContain('MetricCode.ValueAttributes.unit');
    expect(paths).toContain('MetricCode.ValueAttributes.dataType');
    expect(paths).not.toContain('MetadataValue.Label');
  });

  it('QuestionCode Add with clinical attributes emits parent and question attribute paths', () => {
    const paths = objectPaths({
      entityType: 'value',
      metadataTypeCode: 'QuestionCode',
      metadataValueCode: 'Q1',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'QuestionCode',
        metadataValueCode: 'Q1',
        label: 'Pain scale',
        status: 'ACTIVE',
        valueAttributes: {
          questionText: 'Rate pain',
          answerScale: '1-10',
          thresholdEligible: true,
        },
      },
    });

    expect(paths).toContain('MetadataValue');
    expect(paths).toContain('QuestionCode.ValueAttributes');
    expect(paths).toContain('QuestionCode.ValueAttributes.answerScale');
    expect(paths).toContain('QuestionCode.ValueAttributes.thresholdEligible');
    expect(paths).not.toContain('MetadataValue.Label');
  });

  it('Condition Add with valueAttributes does not emit generic value attribute paths', () => {
    const paths = objectPaths({
      entityType: 'value',
      metadataTypeCode: 'Condition',
      metadataValueCode: 'HTN',
      workflowOperation: CHANGE_POLICY_OPERATION.ADD,
      basePayload: null,
      proposedPayload: {
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HTN',
        label: 'Hypertension',
        status: 'ACTIVE',
        valueAttributes: { custom: 'x' },
      },
    });

    expect(paths).toEqual(['MetadataValue']);
  });
});

describe('detectFieldChanges Update applicability', () => {
  it('draft-shaped nested applicability detects module expand', () => {
    const change = findChange(
      {
        entityType: 'value',
        metadataTypeCode: 'CourierChannel',
        metadataValueCode: 'HELICOPTER',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: publishedValueBase,
        proposedPayload: {
          metadataTypeCode: 'CourierChannel',
          metadataValueCode: 'HELICOPTER',
          label: 'Helicopter',
          status: 'ACTIVE',
          isGlobal: false,
          applicability: {
            module: ['TASK', 'OKR'],
            category: [],
            condition: [],
            country: [],
            language: [],
          },
        },
      },
      'MetadataValue.ApplicableModules',
    );

    expect(change).toMatchObject({
      objectPath: 'MetadataValue.ApplicableModules',
      operation: CHANGE_POLICY_OPERATION.UPDATE,
      changeKind: 'Expand',
      oldValue: ['TASK'],
      newValue: ['TASK', 'OKR'],
    });
  });

  it('draft-shaped nested applicability detects country expand', () => {
    const base = {
      ...publishedValueBase,
      metadataTypeCode: 'Condition',
      metadataValueCode: 'HTN',
      applicableModules: [],
      applicableCountries: ['US'],
    };
    const change = findChange(
      {
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'HTN',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: base,
        proposedPayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'HTN',
          label: 'Hypertension',
          status: 'ACTIVE',
          applicability: {
            module: [],
            category: [],
            condition: [],
            country: ['US', 'CA'],
            language: [],
          },
        },
      },
      'MetadataValue.ApplicableCountries',
    );

    expect(change).toMatchObject({
      operation: CHANGE_POLICY_OPERATION.UPDATE,
      changeKind: 'Expand',
      oldValue: ['US'],
      newValue: ['US', 'CA'],
    });
  });

  it('draft-shaped nested applicability detects restrict', () => {
    const change = findChange(
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
        proposedPayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'HTN',
          label: 'Hypertension',
          status: 'ACTIVE',
          applicability: {
            module: [],
            category: [],
            condition: ['HTN'],
            country: [],
            language: [],
          },
        },
      },
      'MetadataValue.ApplicableConditions',
    );

    expect(change).toMatchObject({
      changeKind: 'Restrict',
      oldValue: ['HTN', 'DIABETES'],
      newValue: ['HTN'],
    });
  });

  it('flat API payload shape still detects module expand', () => {
    const change = findChange(
      {
        entityType: 'value',
        metadataTypeCode: 'CourierChannel',
        metadataValueCode: 'HELICOPTER',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: publishedValueBase,
        proposedPayload: { applicableModules: ['TASK', 'OKR'] },
      },
      'MetadataValue.ApplicableModules',
    );

    expect(change).toMatchObject({
      changeKind: 'Expand',
      oldValue: ['TASK'],
      newValue: ['TASK', 'OKR'],
    });
  });

  it('does not change simple Add detection after applicability merge fix', () => {
    expect(
      objectPaths({
        entityType: 'value',
        metadataTypeCode: 'Condition',
        metadataValueCode: 'DIABETES',
        workflowOperation: CHANGE_POLICY_OPERATION.ADD,
        basePayload: null,
        proposedPayload: {
          metadataTypeCode: 'Condition',
          metadataValueCode: 'DIABETES',
          label: 'Diabetes',
          applicability: { module: ['CLINICAL'], category: [], condition: [], country: [], language: [] },
        },
      }),
    ).toEqual(['MetadataValue']);
  });

  it('classifies nested module expand via RULE-VALUE-MODULES-EXPAND', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'value',
        metadataTypeCode: 'CourierChannel',
        metadataValueCode: 'HELICOPTER',
        workflowOperation: CHANGE_POLICY_OPERATION.UPDATE,
        basePayload: publishedValueBase,
        proposedPayload: {
          metadataTypeCode: 'CourierChannel',
          metadataValueCode: 'HELICOPTER',
          applicability: {
            module: ['TASK', 'OKR'],
            category: [],
            condition: [],
            country: [],
            language: [],
          },
        },
      },
      catalog,
    );

    expect(impact.changedObjectPaths).toContain('MetadataValue.ApplicableModules');
    expect(impact.policyGroups).toContain(POLICY_GROUP.APPLICABILITY_SCOPE);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.ADDITIVE);
    expect(impact.changes.find((c) => c.objectPath === 'MetadataValue.ApplicableModules')?.changeKind).toBe(
      'Expand',
    );
  });
});

describe('evaluateChangeImpact simple Add', () => {
  it('MetadataType Add stays APPLICABILITY_SCOPE', () => {
    const impact = evaluateChangeImpact(
      {
        entityType: 'type',
        metadataTypeCode: 'CourierChannel',
        workflowOperation: CHANGE_POLICY_OPERATION.ADD,
        basePayload: null,
        proposedPayload: {
          metadataTypeCode: 'CourierChannel',
          displayName: 'Courier Channel',
          valueDataType: 'Enum',
          multiSelectAllowed: false,
          status: 'ACTIVE',
        },
      },
      catalog,
    );

    expect(impact.policyGroups).toEqual([POLICY_GROUP.APPLICABILITY_SCOPE]);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.ADDITIVE);
    expect(impact.changedObjectPaths).toEqual(['MetadataType']);
  });

  it('MetadataValue Add stays APPLICABILITY_SCOPE without label child rule', () => {
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

    expect(impact.policyGroups).toEqual([POLICY_GROUP.APPLICABILITY_SCOPE]);
    expect(impact.versionImpact).toBe(VERSION_IMPACT.ADDITIVE);
    expect(impact.changedObjectPaths).toEqual(['MetadataValue']);
    expect(impact.changedObjectPaths).not.toContain('MetadataValue.Label');
  });
});
