import { BaseResourceMapper } from './BaseResourceMapper';
import { hasAnyNonEmptyStringField, isRecord } from '../utils/data-shape';

export class OrganizationMapper extends BaseResourceMapper {
  readonly resourceType = 'Organization';

  supports(data: unknown): boolean {
    if (!isRecord(data)) {
      return false;
    }

    if (data.resourceType === 'Organization') {
      return true;
    }

    return hasAnyNonEmptyStringField(data, [
      'organizationId',
      'organizationID',
      'organizationName',
      'orgName',
    ]);
  }
}
