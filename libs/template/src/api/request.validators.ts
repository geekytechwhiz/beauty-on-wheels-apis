import type { ZodIssue } from 'zod';
import { TemplateUnauthorizedError, TemplateValidationError } from '../shared';
import {
  resolveOrganizationIdFromRequest,
  resolveTemplateOrganizationId,
  resolveTemplateScope,
  type TemplateScope,
} from '../policies';
import {
  createTemplateBodySchema,
  executeTemplateBodySchema,
  metadataDefinitionPayloadSchema,
  metadataDefinitionUpsertBodySchema,
  metadataListStatusQuerySchema,
  metadataNameSegmentSchema,
  metadataPartitionTypeSchema,
  metadataVersionSegmentSchema,
  publishTemplateBodySchema,
  updateTemplateBodySchema,
} from './request.schemas';

function issueDetails(issues: ZodIssue[]) {
  return issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getIdempotencyKey(req: any): string | undefined {
  const header =
    req.event?.headers?.['Idempotency-Key'] ??
    req.event?.headers?.['idempotency-key'] ??
    req.event?.headers?.['IDEMPOTENCY-KEY'];

  if (typeof header !== 'string' || header.trim() === '') {
    return undefined;
  }

  return header.trim();
}

function requireRequestOrganizationId(req: any): string {
  const organizationId = resolveOrganizationIdFromRequest(req);
  if (!organizationId) {
    throw new TemplateUnauthorizedError();
  }
  req.validatedOrganizationId = organizationId;
  return organizationId;
}

function resolveScopedOrganization(req: any): { requestOrgId: string; orgId: string; scope: TemplateScope } {
  const requestOrgId = requireRequestOrganizationId(req);
  const scope = resolveTemplateScope(req.params?.scope);
  const orgId = resolveTemplateOrganizationId(requestOrgId, scope);
  return { requestOrgId, orgId, scope };
}

export function validateCreateTemplate(req: any) {
  const requestOrgId = requireRequestOrganizationId(req);
  const result = createTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }
  req.validatedCreateTemplate = {
    orgId: requestOrgId,
    body: result.data,
    idempotencyKey: getIdempotencyKey(req),
  };
}

export function validateGetTemplate(req: any) {
  const { orgId, scope } = resolveScopedOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }
  const viewRaw =
    req.query?.view ??
    req.event?.queryStringParameters?.view ??
    req.event?.multiValueQueryStringParameters?.view?.[0];
  const view = typeof viewRaw === 'string' && viewRaw.toLowerCase() === 'raw' ? 'raw' : 'published';
  req.validatedGetTemplate = {
    orgId,
    scope,
    templateId: String(templateId),
    version: req.params?.version ?? undefined,
    view,
  };
}

export function validateUpdateTemplate(req: any) {
  const { orgId, scope } = resolveScopedOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }

  const result = updateTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }

  req.validatedUpdateTemplate = {
    orgId,
    scope,
    templateId: String(templateId),
    body: result.data,
    idempotencyKey: getIdempotencyKey(req),
  };
}

export function validateExecuteTemplate(req: any) {
  const requestOrgId = requireRequestOrganizationId(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }

  const result = executeTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }

  req.validatedExecuteTemplate = {
    orgId: requestOrgId,
    templateId: String(templateId),
    body: result.data,
  };
}

export function validatePublishTemplate(req: any) {
  const { orgId, scope } = resolveScopedOrganization(req);
  const templateId = req.params?.id ?? req.pathParameters?.id;
  if (!templateId || String(templateId).trim() === '') {
    throw new TemplateValidationError('template id is required', 'COMMON.BAD_REQUEST');
  }

  const result = publishTemplateBodySchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new TemplateValidationError(
      result.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(result.error.issues),
    );
  }

  req.validatedPublishTemplate = {
    orgId,
    scope,
    templateId: String(templateId),
    body: result.data,
    idempotencyKey: getIdempotencyKey(req),
  };
}

export function validateListApplicableMetadata(req: any) {
  const p = req.params ?? {};
  const templateType = typeof p.templateType === 'string' ? p.templateType : '';
  const category = typeof p.category === 'string' ? p.category : '';
  const condition = typeof p.condition === 'string' ? p.condition : '';
  const country = typeof p.country === 'string' ? p.country : '';
  req.validatedListApplicableMetadata = {
    templateType,
    category,
    condition,
    country,
  };
}

export function validateListMetadataByType(req: any) {
  const rawType = req.params?.type ?? req.pathParameters?.type;
  const typeResult = metadataPartitionTypeSchema.safeParse(
    typeof rawType === 'string' ? rawType : '',
  );
  if (!typeResult.success) {
    throw new TemplateValidationError(
      typeResult.error.issues[0]?.message ?? 'Invalid metadata type',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(typeResult.error.issues),
    );
  }
  const statusRaw = req.params?.status;
  const statusResult = metadataListStatusQuerySchema.safeParse(
    statusRaw === undefined || statusRaw === null || statusRaw === ''
      ? undefined
      : String(statusRaw),
  );
  if (!statusResult.success) {
    throw new TemplateValidationError(
      statusResult.error.issues[0]?.message ?? 'Invalid status filter',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(statusResult.error.issues),
    );
  }
  req.validatedListMetadataByType = {
    metadataType: typeResult.data,
    status: statusResult.data,
  };
}

export function validateListMetadataVersions(req: any) {
  const rawType = req.params?.type ?? req.pathParameters?.type;
  const rawName = req.params?.name ?? req.pathParameters?.name;
  const typeResult = metadataPartitionTypeSchema.safeParse(
    typeof rawType === 'string' ? rawType : '',
  );
  const nameResult = metadataNameSegmentSchema.safeParse(
    typeof rawName === 'string' ? decodePathSegment(rawName) : '',
  );
  if (!typeResult.success || !nameResult.success) {
    const issues = [...(typeResult.success ? [] : typeResult.error.issues), ...(nameResult.success ? [] : nameResult.error.issues)];
    throw new TemplateValidationError(
      issues[0]?.message ?? 'Invalid path',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(issues),
    );
  }
  req.validatedListMetadataVersions = {
    metadataType: typeResult.data,
    name: nameResult.data,
  };
}

export function validateGetMetadataDefinition(req: any) {
  const rawType = req.params?.type ?? req.pathParameters?.type;
  const rawName = req.params?.name ?? req.pathParameters?.name;
  const rawVersion = req.params?.version;
  const typeResult = metadataPartitionTypeSchema.safeParse(
    typeof rawType === 'string' ? rawType : '',
  );
  const nameResult = metadataNameSegmentSchema.safeParse(
    typeof rawName === 'string' ? decodePathSegment(rawName) : '',
  );
  if (!typeResult.success || !nameResult.success) {
    const issues = [...(typeResult.success ? [] : typeResult.error.issues), ...(nameResult.success ? [] : nameResult.error.issues)];
    throw new TemplateValidationError(
      issues[0]?.message ?? 'Invalid path',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(issues),
    );
  }
  let version: string | undefined;
  if (rawVersion !== undefined && rawVersion !== null && String(rawVersion).trim() !== '') {
    const vr = metadataVersionSegmentSchema.safeParse(String(rawVersion));
    if (!vr.success) {
      throw new TemplateValidationError(
        vr.error.issues[0]?.message ?? 'Invalid version',
        'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
        issueDetails(vr.error.issues),
      );
    }
    version = vr.data;
  }
  req.validatedGetMetadataDefinition = {
    metadataType: typeResult.data,
    name: nameResult.data,
    version,
  };
}

export function validateCreateMetadataDefinition(req: any) {
  const rawType = req.params?.type ?? req.pathParameters?.type;
  const typeResult = metadataPartitionTypeSchema.safeParse(
    typeof rawType === 'string' ? rawType : '',
  );
  if (!typeResult.success) {
    throw new TemplateValidationError(
      typeResult.error.issues[0]?.message ?? 'Invalid metadata type',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(typeResult.error.issues),
    );
  }
  const bodyResult = metadataDefinitionPayloadSchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    throw new TemplateValidationError(
      bodyResult.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(bodyResult.error.issues),
    );
  }
  req.validatedCreateMetadataDefinition = {
    metadataType: typeResult.data,
    body: bodyResult.data,
  };
}

export function validateUpsertMetadataDefinition(req: any) {
  const rawType = req.params?.type ?? req.pathParameters?.type;
  const rawName = req.params?.name ?? req.pathParameters?.name;
  const rawVersion = req.params?.version ?? req.pathParameters?.version;
  const typeResult = metadataPartitionTypeSchema.safeParse(
    typeof rawType === 'string' ? rawType : '',
  );
  const nameResult = metadataNameSegmentSchema.safeParse(
    typeof rawName === 'string' ? decodePathSegment(rawName) : '',
  );
  const versionResult = metadataVersionSegmentSchema.safeParse(
    typeof rawVersion === 'string' ? decodePathSegment(rawVersion) : '',
  );
  if (!typeResult.success || !nameResult.success || !versionResult.success) {
    const issues = [
      ...(typeResult.success ? [] : typeResult.error.issues),
      ...(nameResult.success ? [] : nameResult.error.issues),
      ...(versionResult.success ? [] : versionResult.error.issues),
    ];
    throw new TemplateValidationError(
      issues[0]?.message ?? 'Invalid path',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(issues),
    );
  }
  const bodyResult = metadataDefinitionUpsertBodySchema.safeParse(req.body ?? {});
  if (!bodyResult.success) {
    throw new TemplateValidationError(
      bodyResult.error.issues[0]?.message ?? 'Validation failed',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(bodyResult.error.issues),
    );
  }
  req.validatedUpsertMetadataDefinition = {
    metadataType: typeResult.data,
    name: nameResult.data,
    version: versionResult.data,
    body: bodyResult.data,
  };
}

export function validateDeleteMetadataDefinition(req: any) {
  const rawType = req.params?.type ?? req.pathParameters?.type;
  const rawName = req.params?.name ?? req.pathParameters?.name;
  const rawVersion = req.params?.version ?? req.pathParameters?.version;
  const typeResult = metadataPartitionTypeSchema.safeParse(
    typeof rawType === 'string' ? rawType : '',
  );
  const nameResult = metadataNameSegmentSchema.safeParse(
    typeof rawName === 'string' ? decodePathSegment(rawName) : '',
  );
  const versionResult = metadataVersionSegmentSchema.safeParse(
    typeof rawVersion === 'string' ? decodePathSegment(rawVersion) : '',
  );
  if (!typeResult.success || !nameResult.success || !versionResult.success) {
    const issues = [
      ...(typeResult.success ? [] : typeResult.error.issues),
      ...(nameResult.success ? [] : nameResult.error.issues),
      ...(versionResult.success ? [] : versionResult.error.issues),
    ];
    throw new TemplateValidationError(
      issues[0]?.message ?? 'Invalid path',
      'TEMPLATE.TEMPLATE_VALIDATION_FAILED',
      issueDetails(issues),
    );
  }
  req.validatedDeleteMetadataDefinition = {
    metadataType: typeResult.data,
    name: nameResult.data,
    version: versionResult.data,
  };
}
