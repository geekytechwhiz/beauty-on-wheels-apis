import { BaseRepository } from '@api-hub/utils';

import { TaskEntityBuilder } from '../builder/task-entity.builder';
import { TaskKeyBuilder } from '../builder/task-key.builder';
import { TASK_LOOKUP_SK } from '../constants/task.constants';
import { DuplicateTaskError } from '../errors/duplicate-task.error';
import type { CreateCarePlanTaskRequest } from '../models/api/generate-care-plan.request';
import type { CreateMonitoringActionRequest } from '../models/api/create-monitoring-action.request';
import type { CreateRuntimeTaskRequest } from '../models/api/create-runtime-task.request';
import type {
  CompletionEvidenceDdbRecord,
  TaskHistDdbRecord,
  TaskLookupDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import { organizationIdsMatch } from '../utils/organization-ids-match';
import { buildCarePlanTaskKeys } from '../utils/monitoring-idempotency';
import {
  buildDeterministicRuntimeTaskInstanceId,
  buildMonitoringIdempotencyKey,
} from '../utils/monitoring-idempotency';
import { assertTaskTable, isMetaConditionalFailure } from '../utils/task.utils';

export class TaskRepository extends BaseRepository {
  buildMonitoringKeys(input: CreateMonitoringActionRequest): {
    idempotencyKey: string;
    runtimeTaskInstanceId: string;
  } {
    const idempotencyKey = buildMonitoringIdempotencyKey(input);
    const runtimeTaskInstanceId = buildDeterministicRuntimeTaskInstanceId(idempotencyKey);
    return { idempotencyKey, runtimeTaskInstanceId };
  }

  async resolveMonitoringNaturalKey(
    runtimeTaskInstanceId: string,
    organizationId: string,
  ): Promise<TaskMetaDdbRecord | 'missing' | 'foreign_org'> {
    const table = assertTaskTable();
    const lookup = await this.get<TaskLookupDdbRecord>(table, {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
    });
    if (!lookup) return 'missing';
    if (!organizationIdsMatch(lookup.orgId, organizationId)) return 'foreign_org';

    const meta = await this.getMetaByLookup(lookup);
    return meta ?? 'missing';
  }

  async getMetaByLookup(lookup: TaskLookupDdbRecord): Promise<TaskMetaDdbRecord | null> {
    const table = assertTaskTable();
    const patientPk = TaskKeyBuilder.buildPatientPartitionKey(lookup.orgId, lookup.patientId);
    return this.get<TaskMetaDdbRecord>(table, {
      pk: patientPk,
      sk: lookup.taskSk,
    });
  }

  async getLookupByTaskId(runtimeTaskInstanceId: string): Promise<TaskLookupDdbRecord | null> {
    const table = assertTaskTable();
    return this.get<TaskLookupDdbRecord>(table, {
      pk: TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
      sk: TASK_LOOKUP_SK,
    });
  }

  async queryTaskHistory(runtimeTaskInstanceId: string): Promise<TaskHistDdbRecord[]> {
    const table = assertTaskTable();
    return this.query<TaskHistDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
        ':prefix': 'HIST#',
      },
      ScanIndexForward: false,
    });
  }

  async queryTaskHistoryPage(
    runtimeTaskInstanceId: string,
    pageSize: number,
    exclusiveStartKey?: Record<string, unknown>,
  ): Promise<{ items: TaskHistDdbRecord[]; lastEvaluatedKey?: Record<string, unknown> }> {
    const table = assertTaskTable();
    return this.queryPage<TaskHistDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
        ':prefix': 'HIST#',
      },
      ScanIndexForward: false,
      Limit: pageSize,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    });
  }

  async queryCompletionEvidence(runtimeTaskInstanceId: string): Promise<CompletionEvidenceDdbRecord[]> {
    const table = assertTaskTable();
    return this.query<CompletionEvidenceDdbRecord>({
      TableName: table,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': TaskKeyBuilder.toTaskPk(runtimeTaskInstanceId),
        ':prefix': 'EVID#',
      },
      ScanIndexForward: false,
    });
  }

  async createMonitoringTask(input: CreateMonitoringActionRequest): Promise<TaskMetaDdbRecord> {
    const table = assertTaskTable();
    const { idempotencyKey, runtimeTaskInstanceId } = this.buildMonitoringKeys(input);

    const ctx = TaskEntityBuilder.buildMonitoringCreateContext({
      runtimeTaskInstanceId,
      idempotencyKey,
      input,
    });

    const metaPut = TaskEntityBuilder.buildMonitoringMetaRecord(ctx);
    const lookupPut = TaskEntityBuilder.buildMonitoringLookupRecord(ctx);
    const histPut = TaskEntityBuilder.buildMonitoringCreateHistRecord(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: metaPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: lookupPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: histPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
        ],
      });

      return metaPut;
    } catch (err: unknown) {
      if (isMetaConditionalFailure(err)) {
        throw new DuplicateTaskError(runtimeTaskInstanceId);
      }
      throw err;
    }
  }

  buildCarePlanTaskKeys(input: CreateCarePlanTaskRequest): {
    idempotencyKey: string;
    runtimeTaskInstanceId: string;
    generationHash: string;
  } {
    return buildCarePlanTaskKeys(input);
  }

  async resolveCarePlanNaturalKey(
    runtimeTaskInstanceId: string,
    organizationId: string,
  ): Promise<TaskMetaDdbRecord | 'missing' | 'foreign_org'> {
    return this.resolveMonitoringNaturalKey(runtimeTaskInstanceId, organizationId);
  }

  async createCarePlanTask(input: CreateCarePlanTaskRequest): Promise<TaskMetaDdbRecord> {
    const table = assertTaskTable();
    const { idempotencyKey, runtimeTaskInstanceId, generationHash } = this.buildCarePlanTaskKeys(input);

    const ctx = TaskEntityBuilder.buildCarePlanTaskCreateContext({
      runtimeTaskInstanceId,
      idempotencyKey,
      generationHash,
      input,
    });

    const metaPut = TaskEntityBuilder.buildCarePlanMetaRecord(ctx);
    const lookupPut = TaskEntityBuilder.buildCarePlanLookupRecord(ctx);
    const histPut = TaskEntityBuilder.buildCarePlanCreateHistRecord(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: metaPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: lookupPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: histPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
        ],
      });

      return metaPut;
    } catch (err: unknown) {
      if (isMetaConditionalFailure(err)) {
        throw new DuplicateTaskError(runtimeTaskInstanceId);
      }
      throw err;
    }
  }

  async createRuntimeTask(input: CreateRuntimeTaskRequest): Promise<TaskMetaDdbRecord> {
    const table = assertTaskTable();
    const ctx = TaskEntityBuilder.buildRuntimeTaskCreateContext({ input });

    const metaPut = TaskEntityBuilder.buildRuntimeMetaRecord(ctx);
    const lookupPut = TaskEntityBuilder.buildRuntimeLookupRecord(ctx);
    const histPut = TaskEntityBuilder.buildRuntimeCreateHistRecord(ctx);

    try {
      await this.transactWrite({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: metaPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: lookupPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Put: {
              TableName: table,
              Item: histPut as unknown as Record<string, unknown>,
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
        ],
      });

      return metaPut;
    } catch (err: unknown) {
      if (isMetaConditionalFailure(err)) {
        throw new DuplicateTaskError(ctx.runtimeTaskInstanceId);
      }
      throw err;
    }
  }
}
