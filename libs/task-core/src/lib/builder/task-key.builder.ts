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

  static buildGsi1Pk(orgId: string, ownerUserId: string): string {
    return `${this.toOrgId(orgId)}#STAFF#${ownerUserId.trim()}`;
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
}
