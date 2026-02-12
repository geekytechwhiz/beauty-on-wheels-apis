import type { ObservationValue } from '@api-hub/canonical';
import { canonicalToFhirObservation } from './canonicalToFhirObservation';

jest.mock('@api-hub/terminology', () => ({
  mapCode: jest.fn(),
}));

const mapCodeMock = jest.requireMock('@api-hub/terminology').mapCode as jest.Mock;

function minimalObservation(overrides: Partial<ObservationValue> = {}): ObservationValue {
  return {
    id: 'obs-1',
    subjectId: 'patient-1',
    effectiveDateTime: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('canonicalToFhirObservation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mapCodeMock.mockReturnValue(undefined);
  });

  it('maps minimal observation without code', () => {
    const canonical = minimalObservation();
    const result = canonicalToFhirObservation(canonical);
    expect(result).toMatchObject({
      resourceType: 'Observation',
      id: 'obs-1',
      status: 'final',
      subject: { reference: 'Patient/patient-1' },
      effectiveDateTime: '2025-01-15T10:00:00Z',
    });
    expect(result.code).toBeUndefined();
    expect(mapCodeMock).not.toHaveBeenCalled();
  });

  it('includes single coding when terminology mapCode returns undefined', () => {
    const canonical = minimalObservation({
      code: 'bp',
      system: 'http://internal',
      display: 'Blood pressure',
    });
    const result = canonicalToFhirObservation(canonical);
    expect(result.code?.coding).toHaveLength(1);
    expect(result.code?.coding?.[0]).toEqual({
      system: 'http://internal',
      code: 'bp',
      display: 'Blood pressure',
    });
    expect(mapCodeMock).toHaveBeenCalledWith('bp', 'http://internal', 'http://loinc.org');
  });

  it('includes mapped LOINC coding first when mapCode returns a mapping', () => {
    mapCodeMock.mockReturnValue({
      system: 'http://loinc.org',
      code: '85354-9',
      display: 'Blood pressure',
    });
    const canonical = minimalObservation({
      code: 'bp',
      system: 'http://internal',
      display: 'Blood pressure',
    });
    const result = canonicalToFhirObservation(canonical);
    expect(result.code?.coding).toHaveLength(2);
    expect(result.code?.coding?.[0]).toEqual({
      system: 'http://loinc.org',
      code: '85354-9',
      display: 'Blood pressure',
    });
    expect(result.code?.coding?.[1]).toMatchObject({
      system: 'http://internal',
      code: 'bp',
      display: 'Blood pressure',
    });
  });

  it('maps valueQuantity and valueCodeableConcept', () => {
    const canonical = minimalObservation({
      valueQuantity: { value: 120, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      valueCodeableConcept: { code: 'normal', display: 'Normal', system: 'http://example.com' },
    });
    const result = canonicalToFhirObservation(canonical);
    expect(result.valueQuantity).toEqual({
      value: 120,
      unit: 'mmHg',
      system: 'http://unitsofmeasure.org',
      code: 'mm[Hg]',
    });
    expect(result.valueCodeableConcept?.coding).toHaveLength(1);
    expect(result.valueCodeableConcept?.coding?.[0]).toMatchObject({
      code: 'normal',
      display: 'Normal',
      system: 'http://example.com',
    });
  });

  it('includes device reference when deviceReadingId present', () => {
    const canonical = minimalObservation({ deviceReadingId: 'dev-1' });
    const result = canonicalToFhirObservation(canonical);
    expect(result.device).toEqual({ reference: 'Device/dev-1' });
  });
});
