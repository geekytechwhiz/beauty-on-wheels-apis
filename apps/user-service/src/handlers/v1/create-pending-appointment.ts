import { createChildLogger } from '@api-hub/logger';
import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { Appointment } from '../../models';
import { UserRepository } from '../../repositories/user.repository';
import { validateCreateAppointment } from '../../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const userRepository = new UserRepository();

type CreateAppointmentRequest = Omit<Appointment, 'createdAt' | 'updatedAt' | 'itemType'>;

const handler = async (
  req: LambdaRequest<any> & { validatedCreateAppointment?: CreateAppointmentRequest },
) => {
  const correlationId = req.context.correlationId;
  const appointment = req.validatedCreateAppointment!;
  const logger = createChildLogger(req.context.logger as any, {
    correlationId,
    appointmentId: appointment.appointmentId,
    patientUserId: appointment.patientUserId,
  });

  logger.info({
    event: 'handler_create_appointment_start',
    message: 'Creating appointment',
  });

  const createdAppointment = await userRepository.createAppointment(
    appointment,
    correlationId,
  );

  logger.info({
    event: 'handler_create_appointment_success',
    message: 'Appointment created',
  });

  return createdAppointment;
};

export const main =   withApiHandler(
          {
            operation: 'create.pending.appointment',
            validator: (req) => validateCreateAppointment(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
