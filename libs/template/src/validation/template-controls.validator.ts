import type { MetadataModeKind } from '../domain/metadata-definition.types';
import { TemplateValidationError } from '../shared/template.errors';

export type StructuralControlOp = 'Add' | 'Remove' | 'Update' | 'Min' | 'Max';

export type { MetadataModeKind };

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

const STRUCTURAL_OPS: StructuralControlOp[] = ['Add', 'Remove', 'Update', 'Min', 'Max'];

function isYesNoStructuralValue(v: unknown): boolean {
  if (typeof v !== 'string') {
    return false;
  }
  const t = v.trim().toLowerCase();
  return t === 'yes' || t === 'no';
}

function isNumericLike(v: unknown): boolean {
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return true;
  }
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
    return true;
  }
  return false;
}

/**
 * Validates shape of `config.controlMatrix` when present (authoring-side).
 * Runtime org vs master enforcement remains default DENY via {@link assertOrgChangesRespectMasterControls}.
 */
export function validateControlMatrixConfig(config: Record<string, unknown>): void {
  const raw = config[CONTROL_MATRIX_KEY];
  if (raw === undefined || raw === null) {
    return;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TemplateValidationError(
      'controlMatrix must be an object',
      'TEMPLATE.CONTROL_MATRIX_INVALID',
      undefined,
      undefined,
      CONTROL_MATRIX_KEY,
    );
  }
  const cm = raw as Record<string, unknown>;
  for (const [path, spec] of Object.entries(cm)) {
    if (!path || String(path).trim() === '') {
      throw new TemplateValidationError(
        'controlMatrix paths must be non-empty strings',
        'TEMPLATE.CONTROL_MATRIX_INVALID',
      );
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new TemplateValidationError(
        `controlMatrix["${path}"] must be an object`,
        'TEMPLATE.CONTROL_MATRIX_INVALID',
        undefined,
        undefined,
        path,
      );
    }
    const s = spec as Record<string, unknown>;
    if (s.metadataMode !== undefined) {
      const m = s.metadataMode;
      if (m !== 'Fixed' && m !== 'Expandable' && m !== 'FixedDefaultExpandable') {
        throw new TemplateValidationError(
          `Invalid metadataMode for control path "${path}"`,
          'TEMPLATE.CONTROL_MATRIX_INVALID',
          undefined,
          undefined,
          path,
        );
      }
    }
    const structural = s.structural;
    if (structural === undefined) {
      continue;
    }
    if (typeof structural !== 'object' || Array.isArray(structural)) {
      throw new TemplateValidationError(
        `controlMatrix["${path}"].structural must be an object`,
        'TEMPLATE.CONTROL_MATRIX_INVALID',
        undefined,
        undefined,
        path,
      );
    }
    const st = structural as Record<string, unknown>;
    for (const [op, val] of Object.entries(st)) {
      if (!STRUCTURAL_OPS.includes(op as StructuralControlOp)) {
        throw new TemplateValidationError(
          `Unknown structural op "${op}" for path "${path}"`,
          'TEMPLATE.CONTROL_MATRIX_INVALID',
          undefined,
          { op },
          path,
        );
      }
      if (op === 'Min' || op === 'Max') {
        if (!isNumericLike(val)) {
          throw new TemplateValidationError(
            `Min/Max must be numeric for path "${path}"`,
            'TEMPLATE.CONTROL_MATRIX_INVALID',
            undefined,
            { op },
            path,
          );
        }
      } else if (!isYesNoStructuralValue(val)) {
        throw new TemplateValidationError(
          `Structural op "${op}" for path "${path}" must be Yes or No`,
          'TEMPLATE.CONTROL_MATRIX_INVALID',
          undefined,
          { op, val },
          path,
        );
      }
    }
  }
}
