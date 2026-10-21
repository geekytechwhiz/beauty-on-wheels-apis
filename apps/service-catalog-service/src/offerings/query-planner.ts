import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';
import { OFFERING_FILTERS } from './filter-registry';
import { FILTER_OPERATOR, FilterClause } from './types';

/**
 * Category equality is the only partition selector on the current GSI2
 * discovery items. Other filters stay on that partition.
 * A later definition can set `partition` without changing the handler.
 */
export function selectDiscoveryPartition(clauses: readonly FilterClause[]): string {
  for (const definition of OFFERING_FILTERS) {
    if (definition.partition !== 'category') {
      continue;
    }
    const clause = clauses.find((item) => (
      item.field === definition.field
      && item.operator === FILTER_OPERATOR.EQ
      && typeof item.value === 'string'
    ));
    if (clause && typeof clause.value === 'string') {
      return CatalogKeyBuilder.discoveryCategoryPk(clause.value);
    }
  }
  return CatalogKeyBuilder.discoveryAllPk();
}
