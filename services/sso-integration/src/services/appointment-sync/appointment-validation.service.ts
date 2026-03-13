import { SSORequestContext } from '../../types/common/context.types';
import { Appointment, AppointmentStatus } from '../../types';
import { VisitStatus, VisitType } from '../../types/enums';
import { validateHmsAppointment } from '../../validators/appointment.validator';

const dummyAppointments: Appointment[] = [{
  "appointmentId": 744,
  "startTime": "2026-03-11T13:45:00.000000Z",
  "endTime": "2026-03-11T14:00:00.000000Z",
  "status": AppointmentStatus.SCHEDULED as unknown as AppointmentStatus,
  "notes": null,
  "patient": { 
      "id": 44,
      "mrn": "MR0002189",
      "name": "Varun D",
      "gender": "Male",
      "age": "24 years",
      "dob": null,
      "phone": "87906357321",
      "email": null
  },
  "doctor": {
      "id": 15434,
      "name": "ABDUL RASHID AHMED",
      "department": "GENERAL DOCTORS",
      "phone": "12345987789",
      "email": "hms.docto123r@yopmail.com"
  },
  "consultationType": {
      "id": 208,
      "name": "Test Consultation"
  },
  "visit": {
      "id": 1085,
      "visitType": VisitType.TELECONSULTATION as unknown as VisitType,
      "createdAt": "2026-03-11T13:45:00.000000Z",
      "status": VisitStatus.ACTIVE as unknown as VisitStatus,
  }
}]
interface InvalidAppointmentInfo {
  appointmentId: string | number | undefined;
  reason: string;
}

interface AppointmentValidationResult {
  validAppointments: Appointment[];
  invalidAppointments: InvalidAppointmentInfo[];
}

export class AppointmentValidationService {
  constructor(
    private readonly logger: {
      warn: (meta: unknown) => void;
    },
  ) {}

  validateAppointments(
    appointments: Appointment[],
    context: SSORequestContext,
  ): AppointmentValidationResult {
    const validAppointments: Appointment[] = [];
    const invalidAppointments: InvalidAppointmentInfo[] = [];

    for (const appointment of appointments) {
      const result = validateHmsAppointment(appointment);
      if (!result.valid) {
        invalidAppointments.push({
          appointmentId: appointment.appointmentId,
          reason: result.reason ?? 'invalid_appointment',
        });

        this.logger.warn({
          event: 'appointment_validation_failed',
          appointmentId: appointment.appointmentId,
          reason: result.reason,
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          integrationProviderId: context.integration?.providerId,
          integrationSubdomain: context.integration?.subdomain,
        });

        continue;
      }

      validAppointments.push(appointment);
    }

    return {
      validAppointments,
      invalidAppointments:[],
    };
  }
}

