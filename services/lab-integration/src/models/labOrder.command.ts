/**
 * Canonical lab order command (partner-agnostic).
 * No partner-specific fields.
 */

export interface CreateLabOrderCommand {
  partnerId: string;
  patientId: string;
  patientName?: string;
  testCodes: string[];
  specimenType?: string;
  priority?: 'ROUTINE' | 'URGENT' | 'STAT';
  notes?: string;
  externalReferenceId?: string;
}
