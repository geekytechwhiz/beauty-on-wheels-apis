import { MetadataRegistryClientError } from '@api-hub/service-clients';
import { BaseError } from '@api-hub/utils';
import { toRuntimeTaskCard } from '@api-hub/task-core';

import { getMetadataRegistryClient } from '../clients/metadataRegistry.client';
import {
  buildMetadataLabelLookup,
  collectMetadataTypesFromTasks,
  enrichRuntimeTaskCard,
  enrichRuntimeTaskCards,
  enrichTaskStatusSummaryLabels,
  TASK_CARD_METADATA_TYPE_CODES,
  TaskMetadataReader,
  TaskMetadataRegistryUnavailableError,
  collectMetadataTypeCodesFromWritePayload,
  type MetadataLabelLookup,
  type RuntimeTaskLabelSource,
  type TaskMetadataWriteOperation,
} from '../metadata';
import { resolveRegistryAuthHeader } from '../utils/resolve-registry-auth';

export type MetadataLabelLookupPromise = Promise<MetadataLabelLookup>;

export interface TaskMetadataServiceOptions {
  reader?: TaskMetadataReader;
}

export class TaskMetadataService {
  private readonly reader: TaskMetadataReader;

  constructor(options: TaskMetadataServiceOptions = {}) {
    this.reader = options.reader ?? getMetadataRegistryClient();
  }

  private requireAuth(authHeader?: string): string {
    const resolved = resolveRegistryAuthHeader(authHeader);
    if (!resolved) {
      throw new TaskMetadataRegistryUnavailableError(
        'Authorization is required for metadata registry access',
      );
    }
    return resolved;
  }

  private wrapRegistryError(error: unknown): never {
    if (error instanceof TaskMetadataRegistryUnavailableError) {
      throw error;
    }
    if (error instanceof MetadataRegistryClientError) {
      throw new BaseError(error.message, error.statusCode, error.code, [{ message: error.message }]);
    }
    if (error instanceof BaseError) {
      throw error;
    }
    throw new TaskMetadataRegistryUnavailableError(
      error instanceof Error ? error.message : 'Metadata registry request failed',
    );
  }

  /** Start registry fetch without awaiting — pair with {@link enrichTaskWithLookup}. */
  beginLabelLookup(
    metadataTypeCodes: readonly string[],
    authHeader?: string,
  ): MetadataLabelLookupPromise {
    return this.loadLabelLookup([...metadataTypeCodes], authHeader);
  }

  beginLabelLookupForWrite(
    operation: TaskMetadataWriteOperation,
    payload: unknown,
    authHeader?: string,
  ): MetadataLabelLookupPromise {
    return this.beginLabelLookup(collectMetadataTypeCodesFromWritePayload(operation, payload), authHeader);
  }

  /** Prefetch labels for any field that can appear on a runtime task card (read APIs). */
  beginLabelLookupForTaskCard(authHeader?: string): MetadataLabelLookupPromise {
    return this.beginLabelLookup(TASK_CARD_METADATA_TYPE_CODES, authHeader);
  }

  beginLabelLookupForTasks(
    tasks: RuntimeTaskLabelSource[],
    authHeader?: string,
  ): MetadataLabelLookupPromise {
    return this.beginLabelLookup(collectMetadataTypesFromTasks(tasks), authHeader);
  }

  async enrichTaskWithLookup<T extends RuntimeTaskLabelSource>(
    task: T,
    lookupPromise: MetadataLabelLookupPromise,
  ) {
    const lookup = await lookupPromise;
    return enrichRuntimeTaskCard(task, lookup);
  }

  async enrichTasksWithLookup<T extends RuntimeTaskLabelSource>(
    tasks: T[],
    lookupPromise: MetadataLabelLookupPromise,
  ) {
    if (!tasks.length) {
      await lookupPromise.catch(() => undefined);
      return [];
    }
    const lookup = await lookupPromise;
    return enrichRuntimeTaskCards(tasks, lookup);
  }

  /** Registry fetch runs in parallel with `loadTask` (write APIs — types from request payload). */
  async enrichAfterWrite<T extends RuntimeTaskLabelSource>(
    operation: TaskMetadataWriteOperation,
    writePayload: unknown,
    authHeader: string | undefined,
    loadTask: () => Promise<T>,
  ) {
    const lookupPromise = this.beginLabelLookupForWrite(operation, writePayload, authHeader);
    const task = await loadTask();
    return this.enrichTaskWithLookup(task, lookupPromise);
  }

  /** Registry fetch runs in parallel with `loadTask` (read APIs — task card type bundle). */
  async enrichAfterRead<T extends RuntimeTaskLabelSource>(
    authHeader: string | undefined,
    loadTask: () => Promise<T>,
  ) {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const task = await loadTask();
    return this.enrichTaskWithLookup(task, lookupPromise);
  }

  /** Registry fetch runs in parallel with `loadTasks` (list/read APIs). */
  async enrichManyAfterRead<T extends RuntimeTaskLabelSource>(
    authHeader: string | undefined,
    loadTasks: () => Promise<T[]>,
  ) {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const tasks = await loadTasks();
    return this.enrichTasksWithLookup(tasks, lookupPromise);
  }

  async enrichGenerateCarePlanResults<
    TResult extends { results?: Array<{ task?: RuntimeTaskLabelSource & { runtimeTaskInstanceId?: string } }> },
  >(
    writePayload: unknown,
    authHeader: string | undefined,
    loadResponse: () => Promise<TResult>,
  ): Promise<TResult> {
    const lookupPromise = this.beginLabelLookupForWrite('postGenerateCarePlan', writePayload, authHeader);
    const response = await loadResponse();
    const tasks = (response.results ?? [])
      .map((entry) => entry.task)
      .filter((task): task is RuntimeTaskLabelSource & { runtimeTaskInstanceId: string } => !!task);
    if (!tasks.length) {
      await lookupPromise.catch(() => undefined);
      return response;
    }

    const enriched = await this.enrichTasksWithLookup(tasks, lookupPromise);
    const enrichedById = new Map(enriched.map((task) => [task.runtimeTaskInstanceId, task]));

    return {
      ...response,
      results: (response.results ?? []).map((entry) => {
        const taskId = entry.task?.runtimeTaskInstanceId;
        if (!taskId || !enrichedById.has(taskId)) {
          return entry;
        }
        return { ...entry, task: enrichedById.get(taskId) };
      }),
    };
  }

  /** Write API: create monitoring action — registry fetch runs in parallel with persistence. */
  async enrichCreateMonitoringActionAfterWrite<
    TRecord extends Parameters<typeof toRuntimeTaskCard>[0],
    TOutcome,
  >(
    authHeader: string | undefined,
    body: unknown,
    load: () => Promise<{ record: TRecord; outcome: TOutcome }>,
  ) {
    let outcome!: TOutcome;
    const task = await this.enrichAfterWrite('postMonitoringAction', body, authHeader, async () => {
      const result = await load();
      outcome = result.outcome;
      return toRuntimeTaskCard(result.record);
    });
    return {
      runtimeTaskInstanceId: task.runtimeTaskInstanceId,
      outcome,
      task,
    };
  }

  /** Write API: create runtime task — registry fetch runs in parallel with persistence. */
  async enrichCreateRuntimeTaskAfterWrite<TRecord extends Parameters<typeof toRuntimeTaskCard>[0]>(
    authHeader: string | undefined,
    body: unknown,
    load: () => Promise<{ record: TRecord }>,
  ) {
    const task = await this.enrichAfterWrite('postRuntimeTask', body, authHeader, async () => {
      const { record } = await load();
      return toRuntimeTaskCard(record);
    });
    return {
      runtimeTaskInstanceId: task.runtimeTaskInstanceId,
      task,
    };
  }

  /** Read API: enrich `task` on a result object after loading from persistence. */
  async enrichTaskInResultAfterRead<TResult extends { task: RuntimeTaskLabelSource }>(
    authHeader: string | undefined,
    load: () => Promise<TResult>,
  ): Promise<TResult> {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const result = await load();
    const task = await this.enrichTaskWithLookup(result.task, lookupPromise);
    return { ...result, task };
  }

  /** Write API: enrich `task` on a result object after persistence (patch flows). */
  async enrichTaskInResultAfterWrite<TResult extends { task: RuntimeTaskLabelSource }>(
    operation: TaskMetadataWriteOperation,
    writePayload: unknown,
    authHeader: string | undefined,
    load: () => Promise<TResult>,
  ): Promise<TResult> {
    const lookupPromise = this.beginLabelLookupForWrite(operation, writePayload, authHeader);
    const result = await load();
    const task = await this.enrichTaskWithLookup(result.task, lookupPromise);
    return { ...result, task };
  }

  /** Read API: patient + staff task list buckets. */
  async enrichPatientTasksResultAfterRead<
    TResult extends {
      patientTasks: { items: RuntimeTaskLabelSource[] };
      staffTasks: { items: RuntimeTaskLabelSource[] };
    },
  >(authHeader: string | undefined, load: () => Promise<TResult>): Promise<TResult> {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const result = await load();
    const [patientTasks, staffTasks] = await Promise.all([
      this.enrichTasksWithLookup(result.patientTasks.items, lookupPromise),
      this.enrichTasksWithLookup(result.staffTasks.items, lookupPromise),
    ]);
    return {
      ...result,
      patientTasks: { items: patientTasks },
      staffTasks: { items: staffTasks },
    };
  }

  /** Read API: flat task list. */
  async enrichTaskListResultAfterRead<TResult extends { items: RuntimeTaskLabelSource[] }>(
    authHeader: string | undefined,
    load: () => Promise<TResult>,
  ): Promise<TResult> {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const result = await load();
    const items = await this.enrichTasksWithLookup(result.items, lookupPromise);
    return { ...result, items };
  }

  /** Read API: action center flat list or sectioned layout. */
  async enrichActionCenterResultAfterRead<
    TResult extends
      | { items: RuntimeTaskLabelSource[] }
      | { sections: Record<string, RuntimeTaskLabelSource[] | undefined> },
  >(authHeader: string | undefined, load: () => Promise<TResult>): Promise<TResult> {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const result = await load();

    if ('sections' in result) {
      const sections = { ...result.sections };
      const sectionKeys = Object.keys(sections) as Array<keyof typeof sections>;
      const indexed: Array<{ key: keyof typeof sections; index: number }> = [];
      const flatTasks = sectionKeys.flatMap((key) => {
        const items = sections[key] ?? [];
        return items.map((task, index) => {
          indexed.push({ key, index });
          return task;
        });
      });

      const enriched = await this.enrichTasksWithLookup(flatTasks, lookupPromise);
      enriched.forEach((task, i) => {
        const { key, index } = indexed[i];
        sections[key]![index] = task;
      });

      return { ...result, sections };
    }

    const items = await this.enrichTasksWithLookup(result.items, lookupPromise);
    return { ...result, items };
  }

  /** Read API: task-status-summary readiness + workflow stage labels. */
  async enrichTaskStatusSummaryAfterRead<
    TResult extends { readinessStatus?: string; workflowStage?: string },
  >(authHeader: string | undefined, load: () => Promise<TResult>) {
    const lookupPromise = this.beginLabelLookupForTaskCard(authHeader);
    const result = await load();
    const lookup = await lookupPromise;
    return enrichTaskStatusSummaryLabels(result, lookup);
  }

  private async loadLabelLookup(
    metadataTypeCodes: string[],
    authHeader?: string,
  ): Promise<MetadataLabelLookup> {
    if (!metadataTypeCodes.length) {
      return new Map();
    }

    try {
      const authorization = this.requireAuth(authHeader);
      const registry = await this.reader.getValuesByTypes({ metadataTypeCodes }, authorization);
      return buildMetadataLabelLookup(registry);
    } catch (error) {
      this.wrapRegistryError(error);
    }
  }
}

let taskMetadataService: TaskMetadataService | undefined;

export function getTaskMetadataService(): TaskMetadataService {
  if (!taskMetadataService) {
    taskMetadataService = new TaskMetadataService();
  }
  return taskMetadataService;
}

export function setTaskMetadataServiceForTests(service: TaskMetadataService | undefined): void {
  taskMetadataService = service;
}
