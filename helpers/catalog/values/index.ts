import type { RichValueSeed, SimpleValueSeed } from '../../interfaces';
import { filterValueCatalogForScope, isSmokeTestEnabled } from '../seed-scope';
import {
  CONDITION_RICH_VALUES,
  CONDITION_RICH_VALUE_TYPE_BY_CODE,
  DEVICE_RICH_VALUES,
  DEVICE_RICH_VALUE_TYPE_BY_CODE,
  METRIC_CODE_RICH_VALUES,
  METRIC_CODE_RICH_VALUE_TYPE_BY_CODE,
  QUESTION_CODE_RICH_VALUES,
  QUESTION_CODE_RICH_VALUE_TYPE_BY_CODE,
} from './complex';
import { FOUNDATIONAL_VALUES } from './foundational';
import {
  GEOGRAPHY_RICH_VALUES,
  GEOGRAPHY_RICH_VALUE_TYPE_BY_CODE,
  GEOGRAPHY_SIMPLE_VALUES,
} from './geography';
import { MODULE_SCOPED_VALUES } from './module-scoped';
import { TEMPLATE_VALUES } from './template';

function mergeCatalogs(
  ...parts: Record<string, SimpleValueSeed[]>[]
): Record<string, SimpleValueSeed[]> {
  const out: Record<string, SimpleValueSeed[]> = {};
  for (const part of parts) {
    for (const [type, seeds] of Object.entries(part)) {
      if (!seeds.length) {
        continue;
      }
      const existing = out[type] ?? [];
      out[type] = [...existing, ...seeds];
    }
  }
  return out;
}

/** Simple values seeded in phase 2 (no relationships / valueAttributes). */
export const METADATA_VALUE_CATALOG: Record<string, SimpleValueSeed[]> = filterValueCatalogForScope(
  mergeCatalogs(FOUNDATIONAL_VALUES, GEOGRAPHY_SIMPLE_VALUES, TEMPLATE_VALUES, MODULE_SCOPED_VALUES),
) as Record<string, SimpleValueSeed[]>;

/** Strip Condition/Device entries that are re-seeded in phase 3 with relations. */
const PHASE3_CONDITION_CODES = new Set(['HYPERTENSION', 'DIABETES', 'ANNUAL_WELLNESS']);
const PHASE3_DEVICE_CODES = new Set(['BP_MONITOR', 'GLUCOSE_METER', 'PULSE_OXIMETER']);

if (METADATA_VALUE_CATALOG.Condition) {
  METADATA_VALUE_CATALOG.Condition = METADATA_VALUE_CATALOG.Condition.filter(
    (v) => !PHASE3_CONDITION_CODES.has(v.metadataValueCode),
  );
}
if (METADATA_VALUE_CATALOG.Device) {
  METADATA_VALUE_CATALOG.Device = METADATA_VALUE_CATALOG.Device.filter(
    (v) => !PHASE3_DEVICE_CODES.has(v.metadataValueCode),
  );
}

export const METADATA_RICH_VALUES: RichValueSeed[] = isSmokeTestEnabled()
  ? []
  : [
      ...GEOGRAPHY_RICH_VALUES,
      ...CONDITION_RICH_VALUES,
      ...DEVICE_RICH_VALUES,
      ...METRIC_CODE_RICH_VALUES,
      ...QUESTION_CODE_RICH_VALUES,
    ];

export const RICH_VALUE_TYPE_BY_CODE: Record<string, string> = isSmokeTestEnabled()
  ? {}
  : {
      ...GEOGRAPHY_RICH_VALUE_TYPE_BY_CODE,
      ...CONDITION_RICH_VALUE_TYPE_BY_CODE,
      ...DEVICE_RICH_VALUE_TYPE_BY_CODE,
      ...METRIC_CODE_RICH_VALUE_TYPE_BY_CODE,
      ...QUESTION_CODE_RICH_VALUE_TYPE_BY_CODE,
    };
