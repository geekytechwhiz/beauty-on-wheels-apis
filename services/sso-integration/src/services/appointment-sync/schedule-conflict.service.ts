import { Appointment, Schedule } from '../../types';

export class ScheduleConflictService {
  private parseEpoch(value: unknown): number | null {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    return null;
  }

  private parseDateAndClock(scheduleDate: string, clock: string): number | null {
    const dateMatch = scheduleDate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    const timeMatch = clock.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!dateMatch || !timeMatch) {
      return null;
    }

    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    let hours = Number(timeMatch[1]) % 12;
    const minutes = Number(timeMatch[2]);
    const ampm = timeMatch[3].toUpperCase();
    if (ampm === 'PM') {
      hours += 12;
    }

    return Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  }

  private resolveScheduleStartEpoch(existing: Schedule): number {
    const fromTimestamp = this.parseEpoch(existing.scheduleTimeStamp);
    if (fromTimestamp !== null) {
      return fromTimestamp;
    }

    if (existing.scheduleDate && existing.startTime) {
      const parsed = this.parseDateAndClock(existing.scheduleDate, existing.startTime);
      if (parsed !== null) {
        return parsed;
      }
    }

    return new Date(existing.startTime).getTime();
  }

  private resolveScheduleEndEpoch(existing: Schedule): number {
    if (existing.scheduleDate && existing.endTime) {
      const parsed = this.parseDateAndClock(existing.scheduleDate, existing.endTime);
      if (parsed !== null) {
        return parsed;
      }
    }

    return new Date(existing.endTime).getTime();
  }

  detectScheduleConflict(
    existingSchedules: Schedule[],
    appointment: Appointment,
  ): boolean {
    const appointmentStart = new Date(appointment.startTime ?? '').getTime();
    const appointmentEnd = new Date(appointment.endTime ?? '').getTime();
    if (!Number.isFinite(appointmentStart) || !Number.isFinite(appointmentEnd)) {
      return false;
    }

    return existingSchedules.some((existing) => {
      const existingStart = this.resolveScheduleStartEpoch(existing);
      const existingEnd = this.resolveScheduleEndEpoch(existing);
      if (!Number.isFinite(existingStart) || !Number.isFinite(existingEnd)) {
        return false;
      }

      return appointmentStart < existingEnd && appointmentEnd > existingStart;
    });
  }
}

