/**
 * Base order command containing only canonical fields shared across all partners.
 * Partner-specific fields should be in separate extension types.
 */
export interface BaseCreateOrderCommand {
  partnerId: string;
  patientId: string;
  patientName?: string;
  testCodes: string[];
  specimenType?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'STAT';
  notes?: string;
  externalReferenceId?: string;
}

export interface BaseRescheduleOrderCommand {
  partnerId: string;
  orderId: string;
}

export interface BaseCancelOrderCommand {
  partnerId: string;
  orderId: string;
}
