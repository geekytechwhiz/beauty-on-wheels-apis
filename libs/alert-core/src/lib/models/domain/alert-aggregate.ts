import { Alert } from './alert.model';
import { AlertAssignment } from './alert-assignment.model';
import { AlertSla } from './alert-sla.model';
import { AlertWorkflow } from './alert-workflow.model';

export interface AlertAggregate {
  alert: Alert;
  assignment: AlertAssignment;
  sla: AlertSla;
  workflow: AlertWorkflow;
}
