import { TruTechAppointmentsResponse } from '../types/appointment.types';

/**
 * Dummy appointment data for testing purposes.
 * Used when the external appointment API returns an empty array.
 */
export const DUMMY_APPOINTMENTS_RESPONSE: TruTechAppointmentsResponse = {
  status: 'success',
  appointments: [
    {
      appointment_id: 64,
      start_time: '2026-02-25T10:00:00.000000Z',
      end_time: '2026-02-25T10:15:00.000000Z',
      status: 1,
      notes: undefined,
      patient: {
        id: 2165,
        mrn: 'MR0002165',
        name: 'John Tele Doe',
        gender: 'Male',
        age: '30 years',
        dob: '',
        phone: '1231232123',
        email: undefined,
        organizationId: ''
      },
      doctor: {
        id: 4,
        name: 'ABDUL RASHID AHMED',
        department: 'GENERAL DOCTORS',
        phone: '++++++++++0372807',
        email: 'abdul@hms.com'
      },
      consultation_type: {
        id: 208,
        name: 'Test Consultation'
      },
      visit: {
        id: 1058,
        visit_type: 1,
        created_at: '2026-02-25T10:00:00.000000Z',
        status: 1
      }
    },
    {
      appointment_id: 65,
      start_time: '2026-02-25T10:45:00.000000Z',
      end_time: '2026-02-25T11:00:00.000000Z',
      status: 1,
      notes: undefined,
      patient: {
        id: 2166,
        mrn: 'MR0002166',
        name: 'Jane Tele LN',
        gender: 'Female',
        age: '23 years 3 months',
        dob: '',
        phone: '1234565437',
        email: undefined,
        organizationId: ''
      },
      doctor: {
        id: 4,
        name: 'ABDUL RASHID AHMED',
        department: 'GENERAL DOCTORS',
        phone: '++++++++++0372807',
        email: 'abdul@hms.com'
      },
      consultation_type: {
        id: 208,
        name: 'Test Consultation'
      },
      visit: {
        id: 1059,
        visit_type: 1,
        created_at: '2026-02-25T10:45:00.000000Z',
        status: 1
      }
    },
    {
      appointment_id: 66,
      start_time: '2026-02-25T13:45:00.000000Z',
      end_time: '2026-02-25T14:00:00.000000Z',
      status: 1,
      notes: undefined,
      patient: {
        id: 2167,
        mrn: 'MR0002167',
        name: 'Test Pat Tele LN',
        gender: 'Male',
        age: '23 years 3 months',
        dob: '',
        phone: '987654131',
        email: undefined,
        organizationId: ''
      },
      doctor: {
        id: 4,
        name: 'ABDUL RASHID AHMED',
        department: 'GENERAL DOCTORS',
        phone: '++++++++++0372807',
        email: 'abdul@hms.com'
      },
      consultation_type: {
        id: 208,
        name: 'Test Consultation'
      },
      visit: {
        id: 1060,
        visit_type: 1,
        created_at: '2026-02-25T13:45:00.000000Z',
        status: 1
      }
    }
  ]
};
