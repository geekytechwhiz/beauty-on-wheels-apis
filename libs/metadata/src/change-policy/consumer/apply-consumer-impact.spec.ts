import { RUNTIME_IMPACT } from '../types/policy-group.codes';
import { applyConsumerImpact } from './apply-consumer-impact';
import { METADATA_CONSUMER } from './consumer-impact.types';

describe('applyConsumerImpact', () => {
  it('returns no current impact for first-time MetadataType Add', () => {
    const result = applyConsumerImpact({
      policyFlags: {
        requiresTemplateAdoption: false,
        requiresOrgCapabilityReevaluation: true,
        runtimeImpact: RUNTIME_IMPACT.NONE,
      },
      consumerContext: { adoptedConsumers: [] },
      isFirstTimeCreate: true,
    });

    expect(result).toEqual({
      requiresTemplateAdoption: false,
      requiresOrgCapabilityReevaluation: false,
      affectedConsumers: [],
    });
  });

  it('returns no current impact for first-time MetadataValue Add with template policy flags', () => {
    const result = applyConsumerImpact({
      policyFlags: {
        requiresTemplateAdoption: true,
        requiresOrgCapabilityReevaluation: true,
        runtimeImpact: RUNTIME_IMPACT.NONE,
      },
      consumerContext: { adoptedConsumers: [] },
      isFirstTimeCreate: true,
    });

    expect(result).toEqual({
      requiresTemplateAdoption: false,
      requiresOrgCapabilityReevaluation: false,
      affectedConsumers: [],
    });
  });

  it('preserves policy-based impact for published updates when adoption lookup is unavailable', () => {
    const result = applyConsumerImpact({
      policyFlags: {
        requiresTemplateAdoption: true,
        requiresOrgCapabilityReevaluation: true,
        runtimeImpact: RUNTIME_IMPACT.REVIEW_REQUIRED,
      },
      consumerContext: { adoptedConsumers: [] },
      isFirstTimeCreate: false,
    });

    expect(result.requiresTemplateAdoption).toBe(true);
    expect(result.requiresOrgCapabilityReevaluation).toBe(true);
    expect(result.affectedConsumers).toEqual([
      METADATA_CONSUMER.TEMPLATE,
      METADATA_CONSUMER.ORG_CAPABILITY,
      METADATA_CONSUMER.PACKAGE,
      METADATA_CONSUMER.SERVICE_CATALOG,
      METADATA_CONSUMER.APPOINTMENT,
      METADATA_CONSUMER.RUNTIME,
    ]);
  });

  it('gates flags to adopted consumers when adoption context is available', () => {
    const result = applyConsumerImpact({
      policyFlags: {
        requiresTemplateAdoption: true,
        requiresOrgCapabilityReevaluation: true,
        runtimeImpact: RUNTIME_IMPACT.NONE,
      },
      consumerContext: {
        adoptedConsumers: [METADATA_CONSUMER.TEMPLATE, METADATA_CONSUMER.ORG_CAPABILITY],
      },
      isFirstTimeCreate: false,
    });

    expect(result.requiresTemplateAdoption).toBe(true);
    expect(result.requiresOrgCapabilityReevaluation).toBe(true);
    expect(result.affectedConsumers).toEqual([
      METADATA_CONSUMER.TEMPLATE,
      METADATA_CONSUMER.ORG_CAPABILITY,
    ]);
  });
});
