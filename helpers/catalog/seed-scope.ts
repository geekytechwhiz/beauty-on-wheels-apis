import type { SimpleValueSeed } from '../interfaces';



/**

 * Smoke test: seed a small subset for local testing.

 * Set `METADATA_SEED_SMOKE_TEST` to `false` to seed the full Excel catalog.

 */

export const METADATA_SEED_SMOKE_TEST = false;



/** Primary types to seed in smoke mode. */

export const METADATA_SEED_SMOKE_TYPES = ['Country'] as const;



/**

 * Dependency types seeded before {@link METADATA_SEED_SMOKE_TYPES} when smoke mode is on.

 * Only ApplicableModule values referenced by in-scope seeds (all modules on Country rows).

 * If already in the registry, draft/publish conflicts are treated as success.

 */

export const METADATA_SEED_PREREQUISITE_TYPES = ['ApplicableModule'] as const;



const APPLICABILITY_BY_PREREQ_TYPE: {

  typeCode: string;

  pick: (seed: SimpleValueSeed) => string[] | undefined;

}[] = [

  { typeCode: 'ApplicableModule', pick: (seed) => seed.applicableModules },

  { typeCode: 'Category', pick: (seed) => seed.applicableCategories },

  { typeCode: 'Condition', pick: (seed) => seed.applicableConditions },

  { typeCode: 'Country', pick: (seed) => seed.applicableCountries },

  { typeCode: 'Language', pick: (seed) => seed.applicableLanguages },

];



export function isSmokeTestEnabled(): boolean {

  return METADATA_SEED_SMOKE_TEST;

}



function smokeAllowedTypes(): Set<string> {

  return new Set<string>([...METADATA_SEED_PREREQUISITE_TYPES, ...METADATA_SEED_SMOKE_TYPES]);

}



function normalizeToken(raw: string): string {

  return raw.trim().toUpperCase();

}



function collectReferencedValueCodes(

  smokeSeeds: SimpleValueSeed[],

  prerequisiteType: string,

): Set<string> {

  const needed = new Set<string>();

  for (const seed of smokeSeeds) {

    for (const { typeCode, pick } of APPLICABILITY_BY_PREREQ_TYPE) {

      if (typeCode !== prerequisiteType) {

        continue;

      }

      for (const token of pick(seed) ?? []) {

        needed.add(normalizeToken(token));

      }

    }

  }

  return needed;

}



export function filterTypesForScope<T extends { metadataTypeCode: string }>(items: T[]): T[] {

  if (!METADATA_SEED_SMOKE_TEST) {

    return items;

  }

  const allowed = smokeAllowedTypes();

  return items.filter((item) => allowed.has(item.metadataTypeCode));

}



export function filterOrderForScope(order: string[]): string[] {

  if (!METADATA_SEED_SMOKE_TEST) {

    return order;

  }

  const allowed = smokeAllowedTypes();

  return order.filter((code) => allowed.has(code));

}



export function filterValueCatalogForScope(

  catalog: Record<string, SimpleValueSeed[]>,

): Record<string, SimpleValueSeed[]> {

  if (!METADATA_SEED_SMOKE_TEST) {

    return catalog;

  }



  const smokeTypes = new Set<string>(METADATA_SEED_SMOKE_TYPES);

  const prerequisiteTypes = new Set<string>(METADATA_SEED_PREREQUISITE_TYPES);

  const out: Record<string, SimpleValueSeed[]> = {};



  const smokeSeeds: SimpleValueSeed[] = [];

  for (const [type, seeds] of Object.entries(catalog)) {

    if (smokeTypes.has(type)) {

      out[type] = seeds;

      smokeSeeds.push(...seeds);

    }

  }



  for (const prerequisiteType of prerequisiteTypes) {

    const needed = collectReferencedValueCodes(smokeSeeds, prerequisiteType);

    if (!needed.size) {

      continue;

    }

    const seeds = (catalog[prerequisiteType] ?? []).filter((seed) =>

      needed.has(normalizeToken(seed.metadataValueCode)),

    );

    if (seeds.length) {

      out[prerequisiteType] = seeds;

    }

  }



  return out;

}


