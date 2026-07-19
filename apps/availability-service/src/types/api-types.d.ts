/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

export interface Slot {
  id?: string;
  vendorId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  available?: number;
  status?: 'AVAILABLE' | 'FULL' | 'BLOCKED';
}

export interface WorkingHours {
  vendorId?: string;
  dayOfWeek?: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  openTime?: string;
  closeTime?: string;
}

