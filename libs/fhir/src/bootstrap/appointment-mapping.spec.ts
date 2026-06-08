import { bootstrapFhirLibrary } from './index';
import { MappingResolver } from '../resolver/mapping.resolver';
import { mappingRegistry } from '../registry/mapping.registry';
import { FhirTransformationService } from '../services/fhir-transformation.service';

describe('Appointment curated mapping', () => {
  beforeAll(() => {
    bootstrapFhirLibrary();
  });

  it('resolves Appointment mapping from registry', () => {
    const resolver = new MappingResolver(mappingRegistry);
    const mapping = resolver.resolve('Appointment', '', 'R4');

    expect(mapping.resource).toBe('Appointment');
    expect(mapping.fields?.length).toBeGreaterThan(0);
  });

  it('transforms flat canonical appointment to FHIR Appointment', async () => {
    const service = new FhirTransformationService(
      new MappingResolver(mappingRegistry),
    );

    const result = await service.transformCanonicalToFhir('Appointment', {
      appointmentId: 'appt-001',
      bookingId: 'book-123',
      status: 'booked',
      startTime: '2026-06-05T10:00:00Z',
      endTime: '2026-06-05T10:30:00Z',
      description: 'Cardiology consult',
      patientUserId: 'patient-abc',
      doctorUserId: 'doctor-xyz',
      organizationID: 'org-001',
    });

    expect(result.resourceType).toBe('Appointment');
    expect(result.id).toBe('appt-001');
    expect(result.status).toBe('booked');
    expect(result.start).toBe('2026-06-05T10:00:00Z');
    expect(result.end).toBe('2026-06-05T10:30:00Z');
    expect(result.participant).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: { type: 'Patient', reference: 'Patient/patient-abc' },
          status: 'accepted',
        }),
        expect.objectContaining({
          actor: {
            type: 'Practitioner',
            reference: 'Practitioner/doctor-xyz',
          },
          status: 'accepted',
        }),
      ]),
    );
    expect(result.extension).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'urn:myvitalrx:appointment:organization-id',
          valueString: 'org-001',
        }),
      ]),
    );
  });
});
