import { Appointment, Schedule } from '../../types';

export class ScheduleConflictService {
  detectScheduleConflict(
    existingSchedules: Schedule[],
    appointment: Appointment,
  ): boolean {
    const appointmentStart = new Date(appointment.startTime).getTime();
    const appointmentEnd = new Date(appointment.endTime).getTime();

    return existingSchedules.some((existing) => {
      const existingStart = new Date(existing.startTime).getTime();
      const existingEnd = new Date(existing.endTime).getTime();

      return appointmentStart < existingEnd && appointmentEnd > existingStart;
    });
  }
}

