import { RequestContext } from '../../context/request-context';
import { Appointment } from '../../types';
import { validateHmsAppointment } from '../../validators/appointment.validator';

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
    context: RequestContext,
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
      invalidAppointments,
    };
  }
}

