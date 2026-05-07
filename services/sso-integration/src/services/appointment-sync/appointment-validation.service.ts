import { Appointment } from '../../types';
import { SSORequestContext } from '../../types/common/context.types';
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
    context: SSORequestContext,
  ): AppointmentValidationResult {
    const validAppointments: Appointment[] = [];
    const invalidAppointments: InvalidAppointmentInfo[] = [];
    // console.log("appointments received in validateAppointments", JSON.stringify(appointments))
    for (const appointment of appointments) {
    // console.log("appointment received inside for", JSON.stringify(appointment))
        
      const result = validateHmsAppointment(appointment);
      // console.log("validateHmsAppointment", result)
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

