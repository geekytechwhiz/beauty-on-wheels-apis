import { Alert } from '../domain/alert.model';
import { AlertAssignment } from '../domain/alert-assignment.model';
import { AlertSla } from '../domain/alert-sla.model';
import { AlertWorkflow } from '../domain/alert-workflow.model';

export interface AlertDdbRecord extends Alert, AlertAssignment, AlertSla, AlertWorkflow {
  pk: string;
  sk: string;
  entityType: 'ALERT';

  gsi1pk: string;
  gsi1sk: string;

  gsi2pk?: string;
  gsi2sk?: string;

  gsi3pk: string;
  gsi3sk: string;

  gsi4pk: string;
  gsi4sk: string;

  gsi5pk: string;
  gsi5sk: string;
}
