import { bootstrapFhirLibrary } from './index';
import { MappingResolver } from '../resolver/mapping.resolver';
import { mappingRegistry } from '../registry/mapping.registry';
import { FhirTransformationService } from '../services/fhir-transformation.service';

const bloodPressureVital = {
  attributes: {
    utcTimeStamp: '1780662586845',
    notes: '',
    source: 'Manual',
    id: 'fe5fcfab-f9d8-46f4-ba07-d249fac2f791',
    timeStamp: '1780662540000',
    diastolic: '90',
    systolic: '70',
    pulseRate: '90',
    pulseRateUnit: 'bpm',
    vitalType: 'BloodPressure',
    bpUnit: 'mmHg',
    userID: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
    isReadingInvalid: false,
    localTimeZone: 'Asia/Kolkata',
  },
  source: 'Manual',
  vitalType: 'BloodPressure',
  isReadingInvalid: false,
  deviceId: 'c30abb1d9ea104752aca94defa28fadd76619e5f664c0e035cfc00262610a51b',
  syncTimeStamp: '1780662540000',
  userId: '01KSHTY7NCMN9GJZ6P6HYYAV8D',
  organizationId: 'mm3208au877eaa2d',
  configDeviceId: 'ManualBloodPressure',
};

describe('Observation curated mapping', () => {
  beforeAll(() => {
    bootstrapFhirLibrary();
  });

  it('resolves Observation mapping from registry', () => {
    const resolver = new MappingResolver(mappingRegistry);
    const mapping = resolver.resolve('Observation', '', 'R4');

    expect(mapping.resource).toBe('Observation');
    expect(mapping.fields?.length).toBeGreaterThan(0);
  });

  it('transforms blood pressure vital payload to FHIR Observation', async () => {
    const service = new FhirTransformationService(
      new MappingResolver(mappingRegistry),
    );

    const result = await service.transformCanonicalToFhir(
      'Observation',
      bloodPressureVital,
    );

    expect(result.resourceType).toBe('Observation');
    expect(result.id).toBe('fe5fcfab-f9d8-46f4-ba07-d249fac2f791');
    expect(result.status).toBe('final');
    expect(result.code).toMatchObject({
      text: 'BloodPressure',
      coding: [
        expect.objectContaining({
          system: 'http://loinc.org',
          code: '85354-9',
          display: 'BloodPressure',
        }),
      ],
    });
    expect(result.subject).toEqual({
      reference: 'Patient/01KSHTY7NCMN9GJZ6P6HYYAV8D',
    });
    expect(result.effectiveDateTime).toBe(
      new Date(1780662540000).toISOString(),
    );
    expect(result.device).toEqual({
      reference:
        'Device/c30abb1d9ea104752aca94defa28fadd76619e5f664c0e035cfc00262610a51b',
    });
    expect(result.component).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: {
            coding: [
              expect.objectContaining({
                code: '8480-6',
                display: 'Systolic blood pressure',
              }),
            ],
          },
          valueQuantity: expect.objectContaining({
            value: 70,
            unit: 'mmHg',
          }),
        }),
        expect.objectContaining({
          code: {
            coding: [
              expect.objectContaining({
                code: '8462-4',
                display: 'Diastolic blood pressure',
              }),
            ],
          },
          valueQuantity: expect.objectContaining({
            value: 90,
            unit: 'mmHg',
          }),
        }),
        expect.objectContaining({
          code: {
            coding: [
              expect.objectContaining({
                code: '8867-4',
                display: 'Heart rate',
              }),
            ],
          },
          valueQuantity: expect.objectContaining({
            value: 90,
            unit: 'bpm',
          }),
        }),
      ]),
    );
    expect(result.extension).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'urn:myvitalrx:observation:organization-id',
          valueString: 'mm3208au877eaa2d',
        }),
        expect.objectContaining({
          url: 'urn:myvitalrx:observation:config-device-id',
          valueString: 'ManualBloodPressure',
        }),
        expect.objectContaining({
          url: 'urn:myvitalrx:observation:local-time-zone',
          valueString: 'Asia/Kolkata',
        }),
      ]),
    );
  });
});
