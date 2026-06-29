import type { OrgDerivedAdoptPreview } from '../models/api/org-derived.types';
import type { TemplateDdbRecord } from '../models/persistence/template-ddb.model';
import type { TemplateMeta } from '../models/persistence/template-ddb.model';
import {
  buildOrgDerivedAdoptPreview,
  detectVariantLocalChanges,
  resolveCanonicalSnapshotRow,
} from './org-derived-adopt.utils';
import { compareTemplateDisplayVersions, resolveTemplateDisplayVersion } from './template.utils';

const CANONICAL_ORG_ADOPT_FOOTER_NOTE =
  'Adoption updates the org template baseline version; org-derived care plan variants adopt from this canonical template separately.';

/** Baseline org version (set at derive / last adopt); org PUT bumps display version above this. */
export function resolveCanonicalOrgBaselineVersion(meta: TemplateMeta): number {
  if (typeof meta.derivedFromMasterVersion === 'number' && meta.derivedFromMasterVersion > 0) {
    return meta.derivedFromMasterVersion;
  }
  return resolveTemplateDisplayVersion(meta);
}

export function resolveCanonicalOrgSelfUpgrade(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
): boolean {
  const currentVersion = resolveTemplateDisplayVersion(versionRow.meta);
  const baselineVersion = resolveCanonicalOrgBaselineVersion(versionRow.meta ?? metaRow.meta);
  return compareTemplateDisplayVersions(currentVersion, baselineVersion) > 0;
}

export function buildCanonicalOrgSelfAdoptPreview(params: {
  metaRow: TemplateDdbRecord;
  versionRow: TemplateDdbRecord;
}): OrgDerivedAdoptPreview | null {
  const { metaRow, versionRow } = params;
  const baselineVersion = resolveCanonicalOrgBaselineVersion(versionRow.meta ?? metaRow.meta);
  const currentVersion = resolveTemplateDisplayVersion(versionRow.meta);

  const baselineRow =
    resolveCanonicalSnapshotRow({
      latestRow: versionRow,
      snapshotVersion: baselineVersion,
      snapshotVersionId: versionRow.meta.templateVersionId,
      rowAtVersionId: versionRow,
    }) ?? versionRow;

  const preview = buildOrgDerivedAdoptPreview({
    variantMeta: metaRow.meta,
    variantVersionRow: versionRow,
    canonicalFromRow: baselineRow,
    canonicalToRow: versionRow,
    sourceOrgTemplateId: metaRow.meta.templateId,
  });

  if (!preview || currentVersion <= baselineVersion) {
    return null;
  }

  return {
    ...preview,
    footerNote: CANONICAL_ORG_ADOPT_FOOTER_NOTE,
    localChangesPresent: detectVariantLocalChanges(versionRow, baselineRow),
    localChangesLabel: detectVariantLocalChanges(versionRow, baselineRow) ? 'Present' : 'None',
  };
}

export function resolveCanonicalOrgUpgradeContext(
  metaRow: TemplateDdbRecord,
  versionRow: TemplateDdbRecord,
): { upgrade: boolean; adopt: OrgDerivedAdoptPreview | null } {
  const upgrade = resolveCanonicalOrgSelfUpgrade(metaRow, versionRow);
  const adopt = upgrade ? buildCanonicalOrgSelfAdoptPreview({ metaRow, versionRow }) : null;
  return { upgrade, adopt };
}
