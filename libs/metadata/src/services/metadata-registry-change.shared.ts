import { metadataTypeToAuditSnapshot } from '../domain/type-audit-delta';
import { metadataValueToAuditSnapshot } from '../domain/value-audit-delta';
import {
  applyConsumerImpact,
  evaluateChangeImpact,
  resolveMetadataConsumerContext,
  CHANGE_POLICY_OPERATION,
  RUNTIME_IMPACT,
  VERSION_IMPACT,
  type ChangePolicyOperation,
  type AggregatedChangeImpact,
} from '../change-policy';
import { getMetadataRepository } from '../dynamodb/dynamodb.client';
import { ValidationError } from '../domain/errors';
import {
  CHANGE_REQUEST_OPERATION,
  type ChangeRequestOperation,
} from '../models/change-request.types';
import type { ImpactPreviewResponse } from '../models/impact-preview.types';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';

export function toPolicyWorkflowOperation(operation: ChangeRequestOperation): ChangePolicyOperation {
  return operation === CHANGE_REQUEST_OPERATION.ADD
    ? CHANGE_POLICY_OPERATION.ADD
    : CHANGE_POLICY_OPERATION.UPDATE;
}

export function publishedTypeToBasePayload(record: MetadataTypeRecord): Record<string, unknown> {
  return {
    metadataTypeCode: record.metadataTypeCode,
    ...metadataTypeToAuditSnapshot(record),
    applicableModules: [...(record.applicableModules ?? [])],
    ...(record.attributeSchema !== undefined ? { attributeSchema: record.attributeSchema } : {}),
    ...(record.valueApplicabilityConfig !== undefined
      ? { valueApplicabilityConfig: record.valueApplicabilityConfig }
      : {}),
  };
}

export function publishedValueToBasePayload(record: MetadataValueRecord): Record<string, unknown> {
  return {
    metadataTypeCode: record.metadataTypeCode,
    ...metadataValueToAuditSnapshot(record),
  };
}

export async function loadPublishedBasePayload(
  entityType: 'type' | 'value',
  metadataTypeCode: string,
  metadataValueCode?: string,
): Promise<{ basePayload: Record<string, unknown> | null; baseVersion: number | null }> {
  const repo = await getMetadataRepository();
  if (entityType === 'type') {
    const existing = await repo.getMetadataType(metadataTypeCode);
    if (!existing) {
      return { basePayload: null, baseVersion: null };
    }
    return { basePayload: publishedTypeToBasePayload(existing), baseVersion: existing.version };
  }
  const code = metadataValueCode?.trim();
  if (!code) {
    throw new ValidationError('metadataValueCode is required for value change evaluation', [
      { field: 'metadataValueCode', message: 'Required' },
    ]);
  }
  const existing = await repo.getMetadataValue(metadataTypeCode, code);
  if (!existing) {
    return { basePayload: null, baseVersion: null };
  }
  return { basePayload: publishedValueToBasePayload(existing), baseVersion: existing.version };
}

export function evaluateRegistryChangeImpact(params: {
  entityType: 'type' | 'value';
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string;
  basePayload: Record<string, unknown> | null;
  proposedPayload: Record<string, unknown>;
}): AggregatedChangeImpact {
  return evaluateChangeImpact({
    entityType: params.entityType,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.metadataValueCode,
    workflowOperation: toPolicyWorkflowOperation(params.operation),
    basePayload: params.operation === CHANGE_REQUEST_OPERATION.ADD ? null : params.basePayload,
    proposedPayload: params.proposedPayload,
  });
}

export function toImpactSummary(impact: AggregatedChangeImpact): ImpactPreviewResponse['impactSummary'] {
  return {
    policyGroups: impact.policyGroups,
    versionImpact: impact.versionImpact,
    requiresMetadataVersion: impact.requiresMetadataVersion,
    requiresTemplateAdoption: impact.requiresTemplateAdoption,
    requiresOrgCapabilityReevaluation: impact.requiresOrgCapabilityReevaluation,
    runtimeImpact: impact.runtimeImpact,
    mergeBehavior: impact.mergeBehavior,
    uxDiffRequired: impact.uxDiffRequired,
  };
}

/** True when publish must receive `confirmationAcknowledged: true`. */
export function isConfirmationRequired(
  summary: ImpactPreviewResponse['impactSummary'],
  opts?: { isFirstTimeCreate: boolean; affectedConsumers: string[] },
): boolean {
  if (opts?.isFirstTimeCreate && opts.affectedConsumers.length === 0) {
    return false;
  }
  return (
    summary.versionImpact === VERSION_IMPACT.BREAKING ||
    summary.requiresTemplateAdoption ||
    summary.requiresOrgCapabilityReevaluation ||
    summary.runtimeImpact === RUNTIME_IMPACT.REVIEW_REQUIRED ||
    summary.runtimeImpact === RUNTIME_IMPACT.MIGRATION_REQUIRED
  );
}

export async function buildConsumerGatedImpact(params: {
  entityType: 'type' | 'value';
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string;
  policyImpact: AggregatedChangeImpact;
}): Promise<{
  impactSummary: ImpactPreviewResponse['impactSummary'];
  affectedConsumers: string[];
  confirmationRequired: boolean;
}> {
  const isFirstTimeCreate = params.operation === CHANGE_REQUEST_OPERATION.ADD;
  const consumerContext = await resolveMetadataConsumerContext({
    entityType: params.entityType,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.metadataValueCode,
    isFirstTimeCreate,
  });

  const consumerImpact = applyConsumerImpact({
    policyFlags: {
      requiresTemplateAdoption: params.policyImpact.requiresTemplateAdoption,
      requiresOrgCapabilityReevaluation: params.policyImpact.requiresOrgCapabilityReevaluation,
      runtimeImpact: params.policyImpact.runtimeImpact,
    },
    consumerContext,
    isFirstTimeCreate,
  });

  const impactSummary: ImpactPreviewResponse['impactSummary'] = {
    ...toImpactSummary(params.policyImpact),
    requiresTemplateAdoption: consumerImpact.requiresTemplateAdoption,
    requiresOrgCapabilityReevaluation: consumerImpact.requiresOrgCapabilityReevaluation,
  };

  const affectedConsumers = [...consumerImpact.affectedConsumers];

  return {
    impactSummary,
    affectedConsumers,
    confirmationRequired: isConfirmationRequired(impactSummary, {
      isFirstTimeCreate,
      affectedConsumers,
    }),
  };
}
