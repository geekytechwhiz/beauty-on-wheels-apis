import { BaseResourceMapper } from './BaseResourceMapper';
import {
  hasAnyNonEmptyStringField,
  isRecord,
} from '../utils/data-shape';

export class PatientMapper extends BaseResourceMapper {
  readonly resourceType = 'Patient';

  supports(data: unknown): boolean {
    if (!isRecord(data)) {
      return false;
    }

    if (data.resourceType === 'Patient') {
      return true;
    }

    return hasAnyNonEmptyStringField(data, ['patientId', 'mrn']);
  }
}
