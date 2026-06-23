import { REMINDER_CURRENT_SK } from '../constants/task.constants';
import { ASSIGNED_TO_TYPE, type AssignedToType } from '../models/types/task-domain.types';
import { padEpochMs13, dueWindowStartOrMaxMs } from '../utils/task-time';

export class TaskKeyBuilder {
  static toOrgId(orgId: string): string {
    const id = orgId.trim();
    return id.startsWith('ORG#') ? id : `ORG#${id}`;
  }

  static toPatientId(patientId: string): string {
    const id = patientId.trim();
    return id.startsWith('PAT#') ? id : `PAT#${id}`;
  }

  static buildPatientPartitionKey(orgId: string, patientId: string): string {
    return `${this.toOrgId(orgId)}#${this.toPatientId(patientId)}`;
  }

  static toTaskPk(runtimeTaskInstanceId: string): string {
    return `TASK#${runtimeTaskInstanceId.trim()}`;
  }

  static buildMetaSk(
    dueWindowStart: number | undefined,
    dueWindowEnd: number | undefined,
    runtimeTaskInstanceId: string,
  ): string {
    const dueMs = dueWindowStartOrMaxMs(dueWindowStart, dueWindowEnd);
    return `DUE#${padEpochMs13(dueMs)}#TASK#${runtimeTaskInstanceId.trim()}`;
  }

  static buildLsi1Sk(carePlanInstanceId: string | undefined, runtimeTaskInstanceId: string): string {
    const cp = carePlanInstanceId?.trim() || 'NONE';
    return `CP#${cp}#TASK#${runtimeTaskInstanceId.trim()}`;
  }

  /**
   * Staff inbox (orgStaff): `ORG#<org>#STAFF#<staffUserId>`.
   * Other assignee types: `ORG#<org>#STAFF#<assignedToType>#<assigneeId>`.
   */
  static buildGsi1Pk(orgId: string, assignedToType: AssignedToType, assigneeId: string): string {
    const org = this.toOrgId(orgId);
    const id = assigneeId.trim();
    if (assignedToType === ASSIGNED_TO_TYPE.ORG_STAFF) {
      return `${org}#STAFF#${id}`;
    }
    return `${org}#STAFF#${assignedToType}#${id}`;
  }

  static buildGsi1Sk(
    dueWindowStart: number | undefined,
    dueWindowEnd: number | undefined,
    patientId: string,
    runtimeTaskInstanceId: string,
  ): string {
    const dueMs = dueWindowStartOrMaxMs(dueWindowStart, dueWindowEnd);
    return `DUE#${padEpochMs13(dueMs)}#PAT#${patientId.trim()}#TASK#${runtimeTaskInstanceId.trim()}`;
  }

  static buildHistSk(transitionAtMs: number, taskStateHistoryId: string): string {
    return `HIST#${padEpochMs13(transitionAtMs)}#${taskStateHistoryId}`;
  }

  static buildReminderCurrentSk(): typeof REMINDER_CURRENT_SK {
    return REMINDER_CURRENT_SK;
  }
}
