import { REMINDER_CURRENT_SK } from '../constants/task.constants';
import { TASK_DDB_KEY_PREFIX } from '../constants/task-key.constants';
import { padEpochMs13, dueWindowStartOrMaxMs } from '../utils/task-time';
export class TaskKeyBuilder {
  static toOrgId(orgId: string): string {
    const id = orgId.trim();
    return id.startsWith(TASK_DDB_KEY_PREFIX.ORG) ? id : `${TASK_DDB_KEY_PREFIX.ORG}${id}`;
  }

  static toPatientId(patientId: string): string {
    const id = patientId.trim();
    return id.startsWith(TASK_DDB_KEY_PREFIX.PAT) ? id : `${TASK_DDB_KEY_PREFIX.PAT}${id}`;
  }

  static buildPatientPartitionKey(orgId: string, patientId: string): string {
    return `${this.toOrgId(orgId)}#${this.toPatientId(patientId)}`;
  }

  static toTaskPk(runtimeTaskInstanceId: string): string {
    return `${TASK_DDB_KEY_PREFIX.TASK}${runtimeTaskInstanceId.trim()}`;
  }

  static buildMetaSk(
    dueWindowStart: number | undefined,
    dueWindowEnd: number | undefined,
    runtimeTaskInstanceId: string,
  ): string {
    const dueMs = dueWindowStartOrMaxMs(dueWindowStart, dueWindowEnd);
    return `${TASK_DDB_KEY_PREFIX.DUE}${padEpochMs13(dueMs)}#${TASK_DDB_KEY_PREFIX.TASK}${runtimeTaskInstanceId.trim()}`;
  }

  static buildLsi1Sk(carePlanInstanceId: string | undefined, runtimeTaskInstanceId: string): string {
    const cp = carePlanInstanceId?.trim() || 'NONE';
    return `${TASK_DDB_KEY_PREFIX.CP}${cp}#${TASK_DDB_KEY_PREFIX.TASK}${runtimeTaskInstanceId.trim()}`;
  }

  /**
   * Staff inbox: `ORG#<org>#STAFF#<assigneeId>`.
   * `assignedToType` (patient, doctor, careTeam, orgStaff, etc.) is stored on META only — not in the GSI key.
   */
  static buildGsi1Pk(orgId: string, assigneeId: string): string {
    const org = this.toOrgId(orgId);
    return `${org}#${TASK_DDB_KEY_PREFIX.STAFF}${assigneeId.trim()}`;
  }
  static buildGsi1Sk(
    dueWindowStart: number | undefined,
    dueWindowEnd: number | undefined,
    patientId: string,
    runtimeTaskInstanceId: string,
  ): string {
    const dueMs = dueWindowStartOrMaxMs(dueWindowStart, dueWindowEnd);
    return `${TASK_DDB_KEY_PREFIX.DUE}${padEpochMs13(dueMs)}#${TASK_DDB_KEY_PREFIX.PAT}${patientId.trim()}#${TASK_DDB_KEY_PREFIX.TASK}${runtimeTaskInstanceId.trim()}`;
  }

  static buildHistSk(transitionAtMs: number, taskStateHistoryId: string): string {
    return `${TASK_DDB_KEY_PREFIX.HIST}${padEpochMs13(transitionAtMs)}#${taskStateHistoryId}`;
  }

  static buildReminderCurrentSk(): typeof REMINDER_CURRENT_SK {
    return REMINDER_CURRENT_SK;
  }
}
