/**
 * Redcliffe-specific types (e.g. API response shapes).
 * Extend as needed when mapping partner responses.
 */
export interface RedcliffeBookingResponse {
  booking_id?: number;
  status?: string;
  errors?: string[];
}
