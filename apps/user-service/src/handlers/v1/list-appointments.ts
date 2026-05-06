import { createChildLogger } from '@api-hub/logger';
import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserRepository } from '../../repositories/user.repository';
import { validateListAppointments } from '../../validation/request.validators';
import { createEventHandler, onEvent } from "@api-hub/event-platform";

const userRepository = new UserRepository();

interface ListAppointmentsParams {
  patientUserId: string;
}

const handler = async (
  req: LambdaRequest<ListAppointmentsParams> & {
    validatedListAppointments?: ListAppointmentsParams;
  },
) => {
  const { patientUserId } = req.validatedListAppointments!;
  const correlationId = req.context.correlationId;
  const logger = createChildLogger(req.context.logger as any, {
    correlationId,
    patientUserId,
  });

  logger.info({
    event: 'handler_list_appointments_start',
    message: 'Listing appointments',
  });

  const appointments = await userRepository.listAppointments(
    patientUserId,
    correlationId,
  );

  logger.info({
    event: 'handler_list_appointments_success',
    message: 'Appointments listed',
    count: appointments.length,
  });

  return appointments;
};

export const main =   withApiHandler(
          {
            operation: 'list.appointments',
            validator: (req) => validateListAppointments(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
