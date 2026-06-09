import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'task-completion' });
const lambdaClient = new LambdaClient({ region: process.env.REGION || 'us-east-1' });

/**
 * Invoke {stage}_global_complete_user_task Lambda for backward compatibility
 * Only for non-third-party devices
 */
export async function completeUserTask(userId: string, organizationId: string, correlationId?: string): Promise<void> {
  const logger = createChildLogger(baseLogger, { correlationId, userId, organizationId });
  const functionName = process.env.COMPLETE_TASK_LAMBDA || '';

  if (!functionName) {
    logger.warn({ event: 'complete_task_lambda_not_configured' });
    return;
  }

  // Skip when running locally (serverless-offline) - Lambda may not exist
  if (process.env.IS_OFFLINE === 'true') {
    logger.debug({ event: 'complete_task_skipped_offline' });
    return;
  }

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event', // Async invocation
        Payload: JSON.stringify({
          userID: userId,
          organizationID: organizationId,
          body: {
            taskId: 'PAIR_DEVICE',
          },
        }),
      }),
    );
    logger.info({ event: 'complete_task_invoked', taskId: 'PAIR_DEVICE' });
  } catch (err) {
    logger.error({ event: 'complete_task_invoke_error', err: serializeError(err) });
    // Don't throw - task completion failures shouldn't break the main flow
  }
}
