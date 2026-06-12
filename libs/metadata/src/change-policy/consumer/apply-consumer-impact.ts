import { RUNTIME_IMPACT } from '../types/policy-group.codes';
import type {
  MetadataConsumerKind,
  MetadataConsumerContext,
  PolicyConsumerFlags,
  ResolvedConsumerImpact,
} from './consumer-impact.types';
import { METADATA_CONSUMER } from './consumer-impact.types';

const ORG_CAPABILITY_CONSUMERS: MetadataConsumerKind[] = [
  METADATA_CONSUMER.ORG_CAPABILITY,
  METADATA_CONSUMER.PACKAGE,
  METADATA_CONSUMER.SERVICE_CATALOG,
  METADATA_CONSUMER.APPOINTMENT,
];

function deriveAffectedConsumersFromPolicy(flags: PolicyConsumerFlags): MetadataConsumerKind[] {
  const out = new Set<MetadataConsumerKind>();
  if (flags.requiresTemplateAdoption) {
    out.add(METADATA_CONSUMER.TEMPLATE);
  }
  if (flags.requiresOrgCapabilityReevaluation) {
    for (const consumer of ORG_CAPABILITY_CONSUMERS) {
      out.add(consumer);
    }
  }
  if (
    flags.runtimeImpact === RUNTIME_IMPACT.REVIEW_REQUIRED ||
    flags.runtimeImpact === RUNTIME_IMPACT.MIGRATION_REQUIRED
  ) {
    out.add(METADATA_CONSUMER.RUNTIME);
  }
  return [...out];
}

function deriveAffectedConsumersFromAdopted(
  adoptedConsumers: MetadataConsumerKind[],
  flags: PolicyConsumerFlags,
): MetadataConsumerKind[] {
  const out = new Set<MetadataConsumerKind>();
  const adopted = new Set(adoptedConsumers);

  if (flags.requiresTemplateAdoption && adopted.has(METADATA_CONSUMER.TEMPLATE)) {
    out.add(METADATA_CONSUMER.TEMPLATE);
  }

  if (flags.requiresOrgCapabilityReevaluation) {
    for (const consumer of ORG_CAPABILITY_CONSUMERS) {
      if (adopted.has(consumer)) {
        out.add(consumer);
      }
    }
  }

  if (
    (flags.runtimeImpact === RUNTIME_IMPACT.REVIEW_REQUIRED ||
      flags.runtimeImpact === RUNTIME_IMPACT.MIGRATION_REQUIRED) &&
    adopted.has(METADATA_CONSUMER.RUNTIME)
  ) {
    out.add(METADATA_CONSUMER.RUNTIME);
  }

  return [...out];
}

function gatePolicyFlagsByAdoptedConsumers(
  flags: PolicyConsumerFlags,
  adoptedConsumers: MetadataConsumerKind[],
): Pick<ResolvedConsumerImpact, 'requiresTemplateAdoption' | 'requiresOrgCapabilityReevaluation'> {
  const adopted = new Set(adoptedConsumers);
  const orgAdopted = ORG_CAPABILITY_CONSUMERS.some((consumer) => adopted.has(consumer));

  return {
    requiresTemplateAdoption: flags.requiresTemplateAdoption && adopted.has(METADATA_CONSUMER.TEMPLATE),
    requiresOrgCapabilityReevaluation: flags.requiresOrgCapabilityReevaluation && orgAdopted,
  };
}

export interface ApplyConsumerImpactInput {
  policyFlags: PolicyConsumerFlags;
  consumerContext: MetadataConsumerContext;
  isFirstTimeCreate: boolean;
}

/**
 * Maps policy-derived flags to actual downstream impact using live consumer adoption.
 * First-time creates have no adopted consumers — no current impact until a service references the metadata.
 */
export function applyConsumerImpact(input: ApplyConsumerImpactInput): ResolvedConsumerImpact {
  const { policyFlags, consumerContext, isFirstTimeCreate } = input;

  if (isFirstTimeCreate) {
    return {
      requiresTemplateAdoption: false,
      requiresOrgCapabilityReevaluation: false,
      affectedConsumers: [],
    };
  }

  if (consumerContext.adoptedConsumers.length === 0) {
    return {
      requiresTemplateAdoption: policyFlags.requiresTemplateAdoption,
      requiresOrgCapabilityReevaluation: policyFlags.requiresOrgCapabilityReevaluation,
      affectedConsumers: deriveAffectedConsumersFromPolicy(policyFlags),
    };
  }

  const gated = gatePolicyFlagsByAdoptedConsumers(policyFlags, consumerContext.adoptedConsumers);
  return {
    ...gated,
    affectedConsumers: deriveAffectedConsumersFromAdopted(
      consumerContext.adoptedConsumers,
      policyFlags,
    ),
  };
}
