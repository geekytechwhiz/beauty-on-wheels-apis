import { ValidationError } from '../domain/errors';
import { metadataTypeToAuditSnapshot } from '../domain/type-audit-delta';
import { metadataValueToAuditSnapshot } from '../domain/value-audit-delta';
import {
  evaluateChangeImpact,
  getChangePolicyCatalog,
  matchPolicyRules,
  RUNTIME_IMPACT,
  VERSION_IMPACT,
  CHANGE_POLICY_OPERATION,
  type ChangePolicyOperation,
} from '../change-policy';
import { getMetadataRepository } from '../dynamodb/dynamodb.client';
import {
  CHANGE_REQUEST_OPERATION,
  CHANGE_REQUEST_STATUS,
  type ChangeRequestOperation,
} from '../models/change-request.types';
import type { ImpactPreviewResponse } from '../models/impact-preview.types';
import type { MetadataTypeRecord, MetadataValueRecord } from '../models/types';
import type { RegistryPostMetadataInput } from './metadata.service.types';
import { prepareTypeRegistryChange, prepareValueRegistryChange } from './metadata-change-request.service';

function isDraftPreviewBody(body: Record<string, unknown>): boolean {
  const id = body.changeRequestId;
  return typeof id === 'string' && id.trim() !== '';
}

function assertChangeRequestId(body: Record<string, unknown>): string {
  const id = body.changeRequestId;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ValidationError('changeRequestId is required for draft impact preview', [
      { field: 'changeRequestId', message: 'Required' },
    ]);
  }
  return id.trim();
}

function toPolicyWorkflowOperation(operation: ChangeRequestOperation): ChangePolicyOperation {
  return operation === CHANGE_REQUEST_OPERATION.ADD
    ? CHANGE_POLICY_OPERATION.ADD
    : CHANGE_POLICY_OPERATION.UPDATE;
}

function publishedTypeToBasePayload(record: MetadataTypeRecord): Record<string, unknown> {
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

function publishedValueToBasePayload(record: MetadataValueRecord): Record<string, unknown> {
  return {
    metadataTypeCode: record.metadataTypeCode,
    ...metadataValueToAuditSnapshot(record),
  };
}

async function loadPublishedBasePayload(
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
    throw new ValidationError('metadataValueCode is required for value impact preview', [
      { field: 'metadataValueCode', message: 'Required' },
    ]);
  }
  const existing = await repo.getMetadataValue(metadataTypeCode, code);
  if (!existing) {
    return { basePayload: null, baseVersion: null };
  }
  return { basePayload: publishedValueToBasePayload(existing), baseVersion: existing.version };
}

function resolveNextVersion(
  operation: ChangeRequestOperation,
  baseVersion: number | null,
  requiresMetadataVersion: boolean,
): number | null {
  if (operation === CHANGE_REQUEST_OPERATION.ADD) {
    return 1;
  }
  if (baseVersion === null) {
    return null;
  }
  return requiresMetadataVersion ? baseVersion + 1 : baseVersion;
}

function isConfirmationRequired(summary: ImpactPreviewResponse['impactSummary']): boolean {
  return (
    summary.versionImpact === VERSION_IMPACT.BREAKING ||
    summary.requiresTemplateAdoption ||
    summary.requiresOrgCapabilityReevaluation ||
    summary.runtimeImpact === RUNTIME_IMPACT.REVIEW_REQUIRED ||
    summary.runtimeImpact === RUNTIME_IMPACT.MIGRATION_REQUIRED
  );
}

function deriveAffectedConsumers(summary: ImpactPreviewResponse['impactSummary']): string[] {
  const out = new Set<string>();
  if (summary.requiresTemplateAdoption) {
    out.add('Template');
  }
  if (summary.requiresOrgCapabilityReevaluation) {
    out.add('OrgCapability');
    out.add('Package');
    out.add('ServiceCatalog');
    out.add('Appointment');
  }
  if (
    summary.runtimeImpact === RUNTIME_IMPACT.REVIEW_REQUIRED ||
    summary.runtimeImpact === RUNTIME_IMPACT.MIGRATION_REQUIRED
  ) {
    out.add('Runtime');
  }
  return [...out];
}

function buildImpactPreviewResponse(params: {
  entityType: 'type' | 'value';
  operation: ChangeRequestOperation;
  metadataTypeCode: string;
  metadataValueCode?: string;
  changeRequestId?: string;
  baseVersion: number | null;
  basePayload: Record<string, unknown> | null;
  proposedPayload: Record<string, unknown>;
}): ImpactPreviewResponse {
  const catalog = getChangePolicyCatalog();
  const workflowOperation = toPolicyWorkflowOperation(params.operation);
  const impact = evaluateChangeImpact({
    entityType: params.entityType,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.metadataValueCode,
    workflowOperation,
    basePayload: params.operation === CHANGE_REQUEST_OPERATION.ADD ? null : params.basePayload,
    proposedPayload: params.proposedPayload,
  });

  const matches = matchPolicyRules(catalog, impact.changes);
  const changedFields = matches.map(({ rule, change }) => ({
    objectPath: change.objectPath,
    operation: change.operation,
    oldValue: params.operation === CHANGE_REQUEST_OPERATION.ADD ? null : (change.oldValue ?? null),
    newValue: change.newValue ?? null,
    policyGroup: rule.policyGroup,
  }));

  const impactSummary: ImpactPreviewResponse['impactSummary'] = {
    policyGroups: impact.policyGroups,
    versionImpact: impact.versionImpact,
    requiresMetadataVersion: impact.requiresMetadataVersion,
    requiresTemplateAdoption: impact.requiresTemplateAdoption,
    requiresOrgCapabilityReevaluation: impact.requiresOrgCapabilityReevaluation,
    runtimeImpact: impact.runtimeImpact,
    mergeBehavior: impact.mergeBehavior,
    uxDiffRequired: impact.uxDiffRequired,
  };

  const nextVersion = resolveNextVersion(
    params.operation,
    params.baseVersion,
    impact.requiresMetadataVersion,
  );

  const response: ImpactPreviewResponse = {
    entityType: params.entityType,
    operation: params.operation,
    metadataTypeCode: params.metadataTypeCode,
    metadataValueCode: params.entityType === 'value' ? (params.metadataValueCode ?? null) : null,
    changeRequestId: params.changeRequestId ?? null,
    baseVersion: params.baseVersion,
    nextVersion,
    changedFields,
    impactSummary,
    confirmationRequired: isConfirmationRequired(impactSummary),
    affectedConsumers: deriveAffectedConsumers(impactSummary),
  };

  return response;
}

async function previewFromDraft(
  input: RegistryPostMetadataInput,
  changeRequestId: string,
): Promise<ImpactPreviewResponse> {
  const repo = await getMetadataRepository();
  const draft = await repo.getChangeRequest(changeRequestId);
  if (!draft) {
    throw new ValidationError(`Change request not found: ${changeRequestId}`, [
      { field: 'changeRequestId', message: 'Not found' },
    ]);
  }
  if (draft.status !== CHANGE_REQUEST_STATUS.DRAFT) {
    throw new ValidationError(`Change request ${changeRequestId} is not in DRAFT status`, [
      { field: 'changeRequestId', message: 'Must be DRAFT' },
    ]);
  }
  if (draft.entityType !== input.entityType) {
    throw new ValidationError(
      `Change request entityType ${draft.entityType} does not match path entityType ${input.entityType}`,
      [{ field: 'entityType', message: 'Mismatch with change request' }],
    );
  }

  let basePayload: Record<string, unknown> | null = null;
  let baseVersion = draft.baseVersion;

  if (draft.operation === CHANGE_REQUEST_OPERATION.ADD) {
    basePayload = null;
    baseVersion = null;
  } else {
    const published = await loadPublishedBasePayload(
      draft.entityType,
      draft.metadataTypeCode,
      draft.metadataValueCode,
    );
    basePayload = published.basePayload;
    baseVersion = published.baseVersion ?? draft.baseVersion;
  }

  return buildImpactPreviewResponse({
    entityType: draft.entityType,
    operation: draft.operation,
    metadataTypeCode: draft.metadataTypeCode,
    metadataValueCode: draft.metadataValueCode,
    changeRequestId: draft.changeRequestId,
    baseVersion,
    basePayload,
    proposedPayload: draft.proposedPayload,
  });
}

async function previewStateless(input: RegistryPostMetadataInput): Promise<ImpactPreviewResponse> {
  if (input.entityType === 'type') {
    const prepared = await prepareTypeRegistryChange(input.body, input.userId);
    const published = await loadPublishedBasePayload('type', prepared.metadataTypeCode);
    const basePayload =
      prepared.operation === CHANGE_REQUEST_OPERATION.ADD ? null : published.basePayload;
    const baseVersion =
      prepared.operation === CHANGE_REQUEST_OPERATION.ADD ? null : published.baseVersion;

    return buildImpactPreviewResponse({
      entityType: 'type',
      operation: prepared.operation,
      metadataTypeCode: prepared.metadataTypeCode,
      baseVersion,
      basePayload,
      proposedPayload: prepared.proposedPayload,
    });
  }

  const prepared = await prepareValueRegistryChange(input.body, input.userId);
  const published = await loadPublishedBasePayload(
    'value',
    prepared.metadataTypeCode,
    prepared.metadataValueCode,
  );
  const basePayload =
    prepared.operation === CHANGE_REQUEST_OPERATION.ADD ? null : published.basePayload;
  const baseVersion =
    prepared.operation === CHANGE_REQUEST_OPERATION.ADD ? null : published.baseVersion;

  return buildImpactPreviewResponse({
    entityType: 'value',
    operation: prepared.operation,
    metadataTypeCode: prepared.metadataTypeCode,
    metadataValueCode: prepared.metadataValueCode,
    baseVersion,
    basePayload,
    proposedPayload: prepared.proposedPayload,
  });
}

/**
 * POST `/metadata/:entityType?action=impact-preview` — evaluate change impact without publishing.
 */
export async function orchestrateRegistryPostImpactPreview(
  input: RegistryPostMetadataInput,
): Promise<ImpactPreviewResponse> {
  if (input.action !== 'impact-preview') {
    throw new ValidationError('Expected action=impact-preview', [{ field: 'action', message: 'Invalid' }]);
  }

  if (isDraftPreviewBody(input.body)) {
    return previewFromDraft(input, assertChangeRequestId(input.body));
  }

  return previewStateless(input);
}
