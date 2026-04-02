import { TemplateValidationError } from '../shared/template.errors';

export type StructuralControlOp = 'Add' | 'Remove' | 'Update' | 'Min' | 'Max';

export type MetadataModeKind = 'Fixed' | 'Expandable' | 'FixedDefaultExpandable';

export interface FieldControlSpec {
  structural?: Partial<Record<StructuralControlOp, string>>;
  metadataMode?: MetadataModeKind;
}

/**
 * Master template may define `controlMatrix` on config (flat path → spec).
 * Missing control for a path → DENY.
 * Yes/No for structural ops (case-insensitive).
 */
const CONTROL_MATRIX_KEY = 'controlMatrix';

function isYes(v: string | undefined): boolean {
  return v !== undefined && String(v).trim().toLowerCase() === 'yes';
}

function flattenLeaves(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === CONTROL_MATRIX_KEY) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenLeaves(v as Record<string, unknown>, p));
    } else {
      out[p] = v;
    }
  }
  return out;
}

function classifyDiff(
  masterFlat: Record<string, unknown>,
  orgFlat: Record<string, unknown>,
): Array<{ path: string; op: StructuralControlOp }> {
  const ops: Array<{ path: string; op: StructuralControlOp }> = [];
  const allKeys = new Set([...Object.keys(masterFlat), ...Object.keys(orgFlat)]);

  for (const path of allKeys) {
    const hasM = Object.prototype.hasOwnProperty.call(masterFlat, path);
    const hasO = Object.prototype.hasOwnProperty.call(orgFlat, path);
    if (!hasM && hasO) {
      ops.push({ path, op: 'Add' });
    } else if (hasM && !hasO) {
      ops.push({ path, op: 'Remove' });
    } else if (hasM && hasO) {
      const a = masterFlat[path];
      const b = orgFlat[path];
      const same =
        typeof a === 'object' && typeof b === 'object'
          ? JSON.stringify(a) === JSON.stringify(b)
          : a === b;
      if (!same) {
        ops.push({ path, op: 'Update' });
      }
    }
  }
  return ops;
}

function extractControlMatrix(masterConfig: Record<string, unknown>): Record<string, FieldControlSpec> {
  const raw = masterConfig[CONTROL_MATRIX_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, FieldControlSpec>;
}

function minMaxOk(meta: FieldControlSpec | undefined, path: string, value: unknown): void {
  if (!meta?.structural) return;
  const min = meta.structural.Min;
  const max = meta.structural.Max;
  if (min !== undefined && typeof value === 'number' && value < Number(min)) {
    throw new TemplateValidationError(
      `Value below Min for ${path}`,
      'TEMPLATE.CONTROL_MIN_VIOLATION',
      undefined,
      { path, min, value },
    );
  }
  if (max !== undefined && typeof value === 'number' && value > Number(max)) {
    throw new TemplateValidationError(
      `Value above Max for ${path}`,
      'TEMPLATE.CONTROL_MAX_VIOLATION',
      undefined,
      { path, max, value },
    );
  }
}

function allowedStructural(spec: FieldControlSpec | undefined, op: StructuralControlOp): boolean {
  if (!spec?.structural) return false;
  const v = spec.structural[op];
  return isYes(v);
}

/**
 * Compares org template config to published master config and enforces per-path controls from master's controlMatrix.
 */
export function assertOrgChangesRespectMasterControls(
  masterConfig: Record<string, unknown>,
  orgConfig: Record<string, unknown>,
): void {
  const controlMatrix = extractControlMatrix(masterConfig);
  const masterFlat = flattenLeaves(masterConfig);
  const orgFlat = flattenLeaves(orgConfig);
  const diffs = classifyDiff(masterFlat, orgFlat);

  for (const { path, op } of diffs) {
    const spec = controlMatrix[path];
    if (op === 'Update' && spec?.metadataMode === 'Fixed') {
      throw new TemplateValidationError(
        `Field "${path}" is Fixed in master control matrix and cannot change`,
        'TEMPLATE.CONTROL_FIXED_VIOLATION',
        undefined,
        { path, op },
      );
    }
    if (!allowedStructural(spec, op)) {
      throw new TemplateValidationError(
        `Org change not permitted for path "${path}" (operation ${op}); control missing or denied`,
        'TEMPLATE.CONTROL_VIOLATION',
        undefined,
        { path, op },
      );
    }
    if (op === 'Update' && Object.prototype.hasOwnProperty.call(orgFlat, path)) {
      minMaxOk(spec, path, orgFlat[path]);
    }
  }
}

export function assertControlMatrixDefined(path: string, spec: FieldControlSpec | undefined): void {
  if (!spec) {
    throw new TemplateValidationError(`Control matrix missing for ${path}`);
  }
}
