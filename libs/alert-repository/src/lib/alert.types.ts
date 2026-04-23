export type AlertState = 'OPEN' | 'ACK' | 'IN_PROGRESS' | 'CLOSED' | 'ESCALATED';

export interface AlertRecord {
  pk: string;
  sk: string;
  alertId: string;
  patientId: string;
  organizationId: string;
  inputEventId: string;
  inputType: string;
  alertState: AlertState;
  priority: number;
  assignedToUserId?: string;
  triggerTimestamp: string;
  slaBreachIndicator: boolean;
  groupingKey?: string;
  alertPolicyTemplateVersionId?: string;
  title?: string;
  detail?: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi3pk?: string;
  gsi3sk?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAlertInput {
  patientId: string;
  organizationId: string;
  inputEventId: string;
  inputType: string;
  priority: number;
  alertPolicyTemplateVersionId?: string;
  groupingKey?: string;
  title?: string;
  detail?: string;
  triggerTimestamp?: string;
}

export interface UpdateAlertInput {
  alertState?: AlertState;
  assignedToUserId?: string | null;
  slaBreachIndicator?: boolean;
}
