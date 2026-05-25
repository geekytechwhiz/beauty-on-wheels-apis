import { BaseResourceMapper } from './BaseResourceMapper';
import { hasAnyNonEmptyStringField, isRecord } from '../utils/data-shape';

export class RelatedPersonMapper extends BaseResourceMapper {
  readonly resourceType = 'RelatedPerson';

  supports(data: unknown): boolean {
    if (!isRecord(data)) {
      return false;
    }

    if (data.resourceType === 'RelatedPerson') {
      return true;
    }

    return hasAnyNonEmptyStringField(data, [
      'invitedBy',
      'caregiverName',
      'caregiverEmail',
      'caregiverPhone',
      'caregiverId',
    ]);
  }
}
