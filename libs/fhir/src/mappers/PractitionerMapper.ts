import { BaseResourceMapper } from './BaseResourceMapper';
import { hasAnyNonEmptyStringField, isRecord } from '../utils/data-shape';

export class PractitionerMapper extends BaseResourceMapper {
  readonly resourceType = 'Practitioner';

  supports(data: unknown): boolean {
    if (!isRecord(data)) {
      return false;
    }

    if (data.resourceType === 'Practitioner') {
      return true;
    }

    return hasAnyNonEmptyStringField(data, ['reporterName', 'reporterEmail']);
  }
}
