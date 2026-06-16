import { CARE_PLAN_INDEX } from '../constants/task.constants';
import { TaskKeyBuilder } from '../builder/task-key.builder';
import { TaskRepository } from './task-repository';

describe('TaskRepository.queryPatientTasksPage', () => {
  const originalTaskTable = process.env.TASK_TABLE;

  beforeAll(() => {
    process.env.TASK_TABLE = 'task-test-table';
  });

  afterAll(() => {
    process.env.TASK_TABLE = originalTaskTable;
  });

  it('queries CarePlanIndex when carePlanInstanceId is provided', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      carePlanInstanceId: 'cp-1',
      workflowStage: 'onboarding',
      currentState: 'active',
      pageSize: 25,
    });

    expect(queryPage).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'task-test-table',
        IndexName: CARE_PLAN_INDEX,
        KeyConditionExpression: 'pk = :pk AND begins_with(lsi1Sk, :cpPrefix)',
        FilterExpression: 'entityType = :metaEntity AND workflowStage = :workflowStage AND currentState = :currentState',
        ExpressionAttributeValues: expect.objectContaining({
          ':pk': TaskKeyBuilder.buildPatientPartitionKey('org-1', 'pat-1'),
          ':cpPrefix': 'CP#cp-1#',
          ':metaEntity': 'RuntimeTaskInstance',
          ':workflowStage': 'onboarding',
          ':currentState': 'active',
        }),
        Limit: 25,
      }),
    );

    queryPage.mockRestore();
  });

  it('queries base table by DUE# prefix when carePlanInstanceId is omitted', async () => {
    const repo = new TaskRepository();
    const queryPage = jest
      .spyOn(repo as unknown as { queryPage: jest.Mock }, 'queryPage')
      .mockResolvedValue({ items: [], lastEvaluatedKey: undefined });

    await repo.queryPatientTasksPage({
      organizationId: 'org-1',
      patientId: 'pat-1',
      pageSize: 10,
    });

    const callArg = queryPage.mock.calls[0][0];
    expect(callArg).toMatchObject({
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :duePrefix)',
      FilterExpression: 'entityType = :metaEntity',
      Limit: 10,
    });
    expect(callArg.IndexName).toBeUndefined();
    expect(callArg.ExpressionAttributeValues).toMatchObject({ ':duePrefix': 'DUE#' });

    queryPage.mockRestore();
  });
});
