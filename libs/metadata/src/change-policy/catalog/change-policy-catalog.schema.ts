import { z } from 'zod';

import {
  APPLICABILITY_CHANGE_KIND_CODES,
  CHANGE_POLICY_OPERATION_CODES,
  MERGE_BEHAVIOR_CODES,
  POLICY_GROUP_CODES,
  RUNTIME_IMPACT_CODES,
  VERSION_IMPACT_CODES,
} from '../types/policy-group.codes';
import type { ChangePolicyCatalog, ChangePolicyRule } from '../types/change-policy.types';

const changePolicyRuleSchema = z.object({
  ruleId: z.string().min(1),
  objectPath: z.string().min(1),
  operation: z.enum(CHANGE_POLICY_OPERATION_CODES as [string, ...string[]]),
  changeKind: z.enum(APPLICABILITY_CHANGE_KIND_CODES as [string, ...string[]]).optional(),
  policyGroup: z.enum(POLICY_GROUP_CODES as [string, ...string[]]),
  versionImpact: z.enum(VERSION_IMPACT_CODES as [string, ...string[]]),
  requiresMetadataVersion: z.boolean(),
  requiresTemplateAdoption: z.boolean(),
  requiresOrgCapabilityReevaluation: z.boolean(),
  runtimeImpact: z.enum(RUNTIME_IMPACT_CODES as [string, ...string[]]),
  canAutoApplyToPublishedCarePlan: z.boolean(),
  canAutoApplyToActiveRuntime: z.boolean(),
  mergeBehavior: z.enum(MERGE_BEHAVIOR_CODES as [string, ...string[]]),
  uxDiffRequired: z.boolean(),
  notes: z.string().optional(),
});

const changePolicyCatalogSchema = z.object({
  version: z.string().min(1),
  rules: z.array(changePolicyRuleSchema).min(1),
});

export class ChangePolicyCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangePolicyCatalogError';
  }
}

function assertUniqueRuleIds(rules: ChangePolicyRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.ruleId)) {
      throw new ChangePolicyCatalogError(`Duplicate ruleId in catalog: ${rule.ruleId}`);
    }
    seen.add(rule.ruleId);
  }
}

function assertUniqueRuleKeys(rules: ChangePolicyRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    const key = `${rule.objectPath}|${rule.operation}|${rule.changeKind ?? 'Any'}`;
    if (seen.has(key)) {
      throw new ChangePolicyCatalogError(`Duplicate catalog key: ${key}`);
    }
    seen.add(key);
  }
}

/** Validates raw catalog JSON and returns a typed catalog. */
export function parseChangePolicyCatalog(raw: unknown): ChangePolicyCatalog {
  const parsed = changePolicyCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ChangePolicyCatalogError(`Invalid change policy catalog: ${parsed.error.message}`);
  }
  const catalog = parsed.data as ChangePolicyCatalog;
  assertUniqueRuleIds(catalog.rules);
  assertUniqueRuleKeys(catalog.rules);
  return catalog;
}
