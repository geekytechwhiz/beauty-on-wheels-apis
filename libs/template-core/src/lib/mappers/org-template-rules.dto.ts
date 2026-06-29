import type { OrgDerivedAdoptPreview } from '../models/api/org-derived.types';
import type { TemplateRulesMap } from '../utils/template-rules.utils';
import { asTemplateRulesMap } from '../utils/template-rules.utils';
import { resolveTemplateDisplayVersion } from '../utils/template.utils';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';

const ORG_VERSION_SYSTEM_KEYS = new Set([
  'pk',
  'sk',
  'entityType',
  'meta',
  'gsi1pk',
  'gsi1sk',
  'gsi2pk',
  'gsi2sk',
  'gsi3pk',
  'gsi3sk',
  'gsi4pk',
  'gsi4sk',
  'gsi5pk',
  'gsi5sk',
  'rules',
]);

export type OrgTemplateRulesResponse = {
  organizationId: string;
  masterTemplateId: string;
  orgTemplateId: string;
  templateVersionId: string;
  version: number;
  templateName?: string;
  templateType?: string;
  status?: string;
  active: boolean;
  templateEnabled: boolean;
  derivedFromMasterVersion?: number;
  derivedFromTemplateVersionId?: string;
  lastModifiedAt?: string;
  fieldValues?: Record<string, unknown>;
  rules: TemplateRulesMap;
  /** True when org template version is ahead of the stored baseline. */
  upgrade: boolean;
  /** Populated when upgrade is true; otherwise null. */
  adopt: OrgDerivedAdoptPreview | null;
} & Record<string, unknown>;

function extractOrgVersionContent(record: TemplateDdbRecord): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!ORG_VERSION_SYSTEM_KEYS.has(key) && value !== undefined) {
      content[key] = value;
    }
  }
  return content;
}

export function toOrgTemplateRulesResponse(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
  opts: {
    organizationId: string;
    masterTemplateId: string;
    templateEnabled: boolean;
    upgrade?: boolean;
    adopt?: OrgDerivedAdoptPreview | null;
  },
): OrgTemplateRulesResponse {
  const meta = versionRow.meta ?? metaRow.meta;
  const content = extractOrgVersionContent(versionRow);

  return {
    organizationId: opts.organizationId,
    masterTemplateId: opts.masterTemplateId,
    orgTemplateId: meta.templateId,
    templateVersionId: meta.templateVersionId ?? '',
    version: resolveTemplateDisplayVersion(meta),
    templateName: meta.templateName,
    templateType: meta.templateType,
    status: meta.status,
    active: meta.isActive !== false,
    templateEnabled: opts.templateEnabled,
    derivedFromMasterVersion: meta.derivedFromMasterVersion,
    derivedFromTemplateVersionId: meta.derivedFromTemplateVersionId,
    lastModifiedAt: meta.lastModifiedAt,
    ...content,
    rules: asTemplateRulesMap(versionRow.rules),
    upgrade: opts.upgrade ?? false,
    adopt: opts.adopt ?? null,
  };
}
