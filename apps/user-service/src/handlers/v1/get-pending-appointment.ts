import { createChildLogger } from '@api-hub/logger';
import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { UserRepository } from '../../repositories/user.repository';
import { validateGetAppointment } from '../../validation/request.validators';

const userRepository = new UserRepository();

interface GetAppointmentParams {
  patientUserId: string;
  appointmentId: string;
}

const handler = async (
  req: LambdaRequest<GetAppointmentParams> & {
    validatedGetAppointment?: GetAppointmentParams;
  },
) => {
  const { patientUserId, appointmentId } = req.validatedGetAppointment!;
  const correlationId = req.context.correlationId;
  const logger = createChildLogger(req.context.logger as any, {
    correlationId,
    appointmentId,
    patientUserId,
  });

  logger.info({
    event: 'handler_get_appointment_start',
    message: 'Fetching appointment',
  });

  const appointment = await userRepository.getAppointment(
    patientUserId,
    appointmentId,
    correlationId,
  );

  if (!appointment) {
    const err: any = new Error('Appointment not found');
    err.statusCode = 404;
    err.code = 'APPOINTMENT_NOT_FOUND';
    throw err;
  }

  logger.info({
    event: 'handler_get_appointment_success',
    message: 'Appointment retrieved',
  });

  return appointment;
};

export const main =   withApiHandler(
          {
            operation: 'get.pending.appointment',
            validator: (req) => validateGetAppointment(req as any),
          },
           async (req) => {
    return await (handler as any)(req);
  },
        );
