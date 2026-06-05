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

type ServiceLogger = {
  warn: (_meta: unknown) => void;
  error: (_meta: unknown) => void;
};

export class AppointmentValidationService {
  private readonly logger: ServiceLogger;

  constructor(logger: ServiceLogger) {
    this.logger = logger;
  }

  validateAppointments(
    appointments: Appointment[],
    context: SSORequestContext,
  ): AppointmentValidationResult {
    const validAppointments: Appointment[] = [];
    const invalidAppointments: InvalidAppointmentInfo[] = [];
    this.logger.warn({
      event: 'appointment_validation_input_received',
      totalAppointments: appointments.length,
      correlationId: context.correlationId,
      tenantId: context.tenantId,
    });
    for (const appointment of appointments) {
      this.logger.warn({
        event: 'appointment_validation_item_received',
        appointmentData: JSON.stringify(appointment,null,2),
        correlationId: context.correlationId,
        tenantId: context.tenantId,
      });
      this.logger.warn({
        event: 'appointment_validation_item_received',
        appointmentId: appointment.appointmentId,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
      });

      const result = validateHmsAppointment(appointment);
      this.logger.warn({
        event: 'appointment_validation_result',
        appointmentId: appointment.appointmentId,
        valid: result.valid,
        reason: result.reason,
        correlationId: context.correlationId,
        tenantId: context.tenantId,
      });
      if (!result.valid) {
        invalidAppointments.push({
          appointmentId: appointment.appointmentId,
          reason: result.reason ?? 'invalid_appointment',
        });

        this.logger.error({
          event: 'appointment_validation_failed',
          appointmentId: appointment.appointmentId,
          reason: result.reason,
          correlationId: context.correlationId,
          tenantId: context.tenantId,
          integrationProviderId: context.integration?.providerId,
          integrationSubdomain: context.integration?.subdomain,
          patientPhoneCode: appointment.patient?.phoneCode,
          doctorPhoneCode: appointment.doctor?.phoneCode,
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

